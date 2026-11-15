from typing import Literal

from pydantic import BaseModel, Field

# HistoryMessage : one previous turn of a conversation. It only
# enters the answer prompt (context for follow-ups); it never
# changes the retrieval query.
class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=1000)

# QueryRequest : request structure of JSON body for /query endpoint.
class QueryRequest(BaseModel):
    query: str = Field(
        ...,                          # ... means required, no default
        min_length=1,
        max_length=500,
        description="Natural language question about your documents",
        examples=["what is my professionalemail", "what is my CGPA"]
    )
    top_k: int = Field(
        default=5,
        ge=1,                         # ge = greater than or equal to
        le=20,                        # le = less than or equal to
        description="Number of document chunks to retrieve"
    )
    history: list[HistoryMessage] | None = Field(
        default=None,
        description="Previous conversation turns (optional). "
                    "Only used as context for the answer prompt, "
                    "never for retrieval."
    )
    context: dict | None = Field(
        default=None,
        description="Current simulated mission state (optional: "
                    "day, hr, spo2, temp, rad). Only used as "
                    "context for the answer prompt, never for "
                    "retrieval."
    )

# SourceReference is what we return to the client for each source that contributed to the answer.
class SourceReference(BaseModel):
    filename: str
    relevance_score: float
    file_url: str = ""

# QueryResponse is the structured response we return from the /query endpoint.
class QueryResponse(BaseModel):
    answer: str
    sources: list[SourceReference]
    query: str                        # echo back the original query

# HealthResponse is a simple schema for a health check endpoint
class HealthResponse(BaseModel):
    status: str
    qdrant: str
    ollama: str