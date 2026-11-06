# 출처: https://github.com/googleapis/python-genai/blob/main/google/genai/_api_client.py
"""Bounded retries for transient Gemini transport and service errors."""

from google import genai
from google.genai import types


def gemini_client(api_key: str) -> genai.Client:
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(
        retry_options=types.HttpRetryOptions(attempts=3, initial_delay=2, max_delay=8)))
