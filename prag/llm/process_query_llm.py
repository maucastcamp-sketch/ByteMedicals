
import logging
from typing import cast

from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage

from llm.chat_llm import get_llm

logger = logging.getLogger(__name__)


class ProcessedQuery(BaseModel):
    improved_query: str = Field(
        description="Query optimized for document retrieval."
    )
    query_type: str = Field(
        default="factual",
        description="Either factual or synthesis."
    )


QUERY_PROCESSOR_PROMPT = """
Eres el procesador de consultas de PRAG, un asistente
que busca información en una base de conocimiento documental.

Tu tarea es preparar las preguntas para mejorar la recuperación
de información en los documentos.

REGLAS:

1. Conserva la intención original de la pregunta.
2. Corrige errores ortográficos cuando sea necesario.
3. No inventes información ni agregues datos que el usuario
   no haya proporcionado.
4. Conserva nombres propios, términos técnicos, siglas,
   números y fechas.
5. No conviertas una pregunta específica en una pregunta general.
6. No elimines palabras importantes para la búsqueda.
7. Responde en el mismo idioma de la pregunta.

CLASIFICACIÓN:

- factual: preguntas que buscan información específica,
  definiciones, datos, nombres, fechas o explicaciones.
- synthesis: preguntas que requieren comparar, relacionar,
  resumir o integrar información de varios documentos.

Devuelve:
- improved_query: la pregunta optimizada.
- query_type: exclusivamente "factual" o "synthesis".
"""


def process_query(raw_query: str) -> ProcessedQuery:
    """Improve and classify a user query for document retrieval."""

    messages = [
        SystemMessage(content=QUERY_PROCESSOR_PROMPT),
        HumanMessage(content=f"Pregunta original: {raw_query}"),
    ]

    structured_llm = get_llm().with_structured_output(ProcessedQuery)

    response: ProcessedQuery = cast(
        ProcessedQuery,
        structured_llm.invoke(messages),
    )

    if response.query_type not in ("factual", "synthesis"):
        response.query_type = "factual"

    if not response.improved_query.strip():
        response.improved_query = raw_query

    logger.info(
        "Processed query: '%s' -> '%s' (%s)",
        raw_query,
        response.improved_query,
        response.query_type,
    )

    return response
