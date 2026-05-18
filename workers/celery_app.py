from celery import Celery
import os
from dotenv import load_dotenv

load_dotenv()

celery = Celery(
    "llm_eval",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    include=["workers.tasks"]
)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    task_track_started=True,
    task_acks_late=True,          # only ack after task completes (safer)
    worker_prefetch_multiplier=1, # one task at a time per worker
)