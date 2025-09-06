import os
from openai import OpenAI

ENV_MODE = os.getenv("LLM_ENV", "local")

if ENV_MODE == "online":
    EMBEDDING_MODEL = "text-embedding-3-small"
    ROUTING_MODEL = "gpt-5-nano"
    OPENAI_LLM_MODEL = "gpt-5-nano"

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

else:
    EMBEDDING_MODEL = "text-embedding-granite-embedding-278m-multilingual"
    ROUTING_MODEL = "openai/gpt-oss-20b"
    OPENAI_LLM_MODEL = "gpt-oss:20b"

    client = OpenAI(base_url="http://localhost:1234/v1", api_key="whatever")