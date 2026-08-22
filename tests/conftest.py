"""
Test fixtures.

The app fixture runs the real Alembic migrations against a temporary SQLite
database rather than calling `create_all`, so the migration chain is exercised
on every test run — a broken migration fails the build here, not on deploy.
"""
import os
import tempfile

import pytest

os.environ.setdefault("GROQ_API_KEY", "")


@pytest.fixture(scope="session")
def app():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"

    # Imported after DATABASE_URL is set: config reads it at import time.
    from flask_migrate import upgrade

    from backend.app import create_app

    application = create_app()
    with application.app_context():
        upgrade()

    yield application
    os.unlink(path)


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def db_session(app):
    from backend.extensions import db

    with app.app_context():
        yield db.session
        db.session.rollback()


@pytest.fixture()
def clean_db(app):
    from backend.extensions import db
    from backend.models.eval_result import EvalResult
    from backend.models.eval_run import EvalRun
    from backend.models.scorer_validation import ScorerValidation

    with app.app_context():
        EvalResult.query.delete()
        EvalRun.query.delete()
        ScorerValidation.query.delete()
        db.session.commit()
    yield
