
import logging
import json
from typing import cast

from langchain.chat_models import init_chat_model, BaseChatModel
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import BaseModel, Field, field_validator

from config.settings import settings

logger = logging.getLogger(__name__)

_llm = None


class LLMResponse(BaseModel):
    answer: str
    used_chunk_indices: list[int] = Field(
        default_factory=list,
        description="One-based indices of the document chunks used."
    )

    @field_validator("used_chunk_indices", mode="before")
    @classmethod
    def parse_indices(cls, value):
        if isinstance(value, list):
            return value

        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                try:
                    return [
                        int(item.strip())
                        for item in value.strip("'{[]}'\"").split(",")
                        if item.strip()
                    ]
                except Exception:
                    return []

        if isinstance(value, int):
            return [value]

        return []


def get_llm() -> BaseChatModel:
    global _llm

    if _llm is None:
        _llm = init_chat_model(
            model=settings.chat_model,
            model_provider=settings.model_provider,
            api_key=(
                settings.groq_api_key
                if settings.model_provider == "groq"
                else None
            ),
        )

    return _llm


SYSTEM_PROMPT = """
Eres PRAG, un asistente de inteligencia artificial que responde
preguntas utilizando una base de conocimiento documental.

Tu conocimiento documental se proporciona en los fragmentos incluidos
en cada consulta.

REGLAS OBLIGATORIAS:

1. Utiliza exclusivamente la información presente en los fragmentos.
2. No inventes nombres, cifras, fechas, explicaciones ni referencias.
3. Responde en el mismo idioma de la pregunta.
4. Contesta directamente lo que se pregunta.
5. Para preguntas técnicas o científicas, ofrece explicaciones claras
   y suficientemente detalladas cuando los documentos lo permitan.
6. Si se pregunta por varios elementos, identifica todos los que
   estén disponibles en los fragmentos.
7. Si la información está incompleta, explica qué información
   encontraste y qué parte no aparece en los documentos.
8. Si no existe información relevante en los documentos, dilo
   claramente y, aun así, da los pasos de a bordo que procedan
   (registrar el síntoma en el Health Log, revisar los signos
   vitales relacionados, vigilar su evolución y avisar al oficial
   médico de la tripulación o al cirujano de vuelo), sin inventar
   datos médicos.
9. No presentes conocimientos generales del modelo como si
   procedieran de los documentos.
10. No afirmes haber consultado archivos que no aparecen en el contexto.

CONTEXTO DE MISIÓN:

- El usuario es un tripulante en una misión espacial de larga
  duración y tú eres su asistente médico de a bordo. Razona
  siempre en ese contexto: no hay un médico al lado, el cirujano
  de vuelo está en la Tierra y la comunicación tiene retardo.
- NUNCA respondas "ve a un doctor" o "consulta a tu médico" como
  si hubiera uno cerca. En su lugar: registra el síntoma, revisa
  los signos vitales relacionados y propón los pasos del
  protocolo de a bordo (registrar en el Health Log, vigilar la
  evolución, avisar al oficial médico de la tripulación o al
  cirujano de vuelo por el enlace con retardo).
- Usa la conversación previa como memoria: si el usuario ya
  mencionó un síntoma, reconócelo y sigue su evolución; no
  vuelvas a preguntar lo mismo ni a empezar de cero.
- Los datos médicos deben salir de los documentos; el contexto de
  misión decide CÓMO responder, no qué hechos inventar. No
  diagnostiques ni prescribas.

SOBRE LOS FRAGMENTOS:

- Cada fragmento tiene un número de identificación.
- used_chunk_indices debe contener los números de los fragmentos
  que realmente utilizaste.
- Los números empiezan en 1.
- Devuelve una lista de enteros, nunca una cadena de texto.
- Si no utilizaste ningún fragmento, devuelve una lista vacía.

La respuesta debe ser útil, precisa y fiel a los documentos.
"""


SYNTHESIS_PROMPT = """
Además de las reglas generales de PRAG:

- Integra la información relevante de varios fragmentos.
- Organiza la respuesta mediante párrafos o listas cuando ayude.
- Explica las relaciones entre los datos únicamente cuando estén
  respaldadas por los documentos.
- No agregues conclusiones ni recomendaciones que no estén
  sustentadas en el contexto.
- Indica claramente cuando existan vacíos de información.
"""


def format_context(chunks: list[dict]) -> str:
    """Format retrieved document chunks for the language model."""

    if not chunks:
        return "No relevant document chunks found."

    formatted = []

    for index, chunk in enumerate(chunks, 1):
        formatted.append(
            f"[FRAGMENTO {index}]\n"
            f"Archivo: {chunk['source_file']}\n"
            f"Relevancia: {chunk['score']}\n"
            f"Contenido:\n{chunk['text'].strip()}"
        )

    return "\n\n---\n\n".join(formatted)


def format_history(history: list[dict] | None) -> str:
    """Format previous conversation turns for the answer prompt.

    History is the conversation's memory: it lets the model follow
    how a symptom evolves across turns ("me duele" -> "sigue
    doliendo"), instead of starting from zero each time. It also
    helps resolve follow-ups ("y de ese tema, ¿qué más?"). The
    answer must still come exclusively from the retrieved document
    chunks.
    """

    if not history:
        return ""

    lines = []
    for turn in history:
        role = "USUARIO" if turn.get("role") == "user" else "ASISTENTE"
        content = str(turn.get("content", "")).strip()
        if content:
            lines.append(f"{role}: {content}")

    if not lines:
        return ""

    return "\n".join(lines)


def format_mission_context(context: dict | None) -> str:
    """Format the current simulated mission state for the answer prompt.

    Only numbers the app already shows on screen (mission day and
    live vitals). It tells the model what the crew member's body is
    doing right now, so a symptom report can be answered in mission
    terms instead of with generic advice.
    """

    if not context:
        return ""

    parts = []
    if context.get("day") is not None:
        parts.append(f"Día de misión: {context['day']}")
    if context.get("hr") is not None:
        parts.append(f"Frecuencia cardíaca: {context['hr']} bpm")
    if context.get("spo2") is not None:
        parts.append(f"SpO2: {context['spo2']}%")
    if context.get("temp") is not None:
        parts.append(f"Temperatura: {context['temp']} °C")
    if context.get("rad") is not None:
        parts.append(f"Radiación acumulada: {context['rad']} mSv")
    if not parts:
        return ""
    return "\n".join(parts)


def call_llm(
    query: str,
    chunks: list[dict],
    query_type: str,
    history: list[dict] | None = None,
    mission_context: dict | None = None,
) -> LLMResponse:
    """Generate a grounded answer using retrieved document chunks."""

    context = format_context(chunks)
    history_text = format_history(history)
    mission_text = format_mission_context(mission_context)

    system_prompt = SYSTEM_PROMPT

    if query_type == "synthesis":
        system_prompt += "\n" + SYNTHESIS_PROMPT

    human_content = f"DOCUMENTOS RECUPERADOS:\n\n{context}\n\n"
    if history_text:
        human_content += (
            "CONVERSACIÓN PREVIA (memoria de esta conversación: usa "
            "lo ya dicho para seguir la evolución de un síntoma; si "
            "el usuario ya mencionó algo, reconócelo y no vuelvas a "
            "preguntar lo mismo; la respuesta debe salir únicamente "
            f"de los fragmentos):\n{history_text}\n\n"
        )
    if mission_text:
        human_content += (
            "ESTADO ACTUAL DE LA MISIÓN (simulado; son los valores "
            "que la app muestra ahora mismo):\n"
            f"{mission_text}\n\n"
        )
    human_content += f"PREGUNTA DEL USUARIO:\n{query}"

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=human_content),
    ]

    structured_llm = get_llm().with_structured_output(LLMResponse)

    response: LLMResponse = cast(
        LLMResponse,
        structured_llm.invoke(messages),
    )

    valid_indices = set(range(1, len(chunks) + 1))

    response.used_chunk_indices = [
        index
        for index in response.used_chunk_indices
        if index in valid_indices
    ]

    logger.info(
        "PRAG used chunks %s for query: '%s'",
        response.used_chunk_indices,
        query,
    )

    return response
