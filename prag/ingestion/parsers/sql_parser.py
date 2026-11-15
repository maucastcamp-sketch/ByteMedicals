
import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)


def parse_sql(path: str) -> str:
    """
    Extract and normalize text from a SQL file.
    Preserves SQL statements, table definitions and comments.
    """

    sql_path = Path(path)

    if not sql_path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    try:
        text = sql_path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        text = sql_path.read_text(encoding="latin-1")

    text = text.strip()

    if not text:
        raise RuntimeError(f"SQL file is empty: {path}")

    # Normalize line endings and excessive blank lines.
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)

    logger.info(
        "Extracted %d characters from SQL file '%s'",
        len(text),
        sql_path.name,
    )

    return text
