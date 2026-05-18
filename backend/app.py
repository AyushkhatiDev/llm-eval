from flask import Flask
from backend.config import Config
from backend.extensions import db, migrate, cors
from backend.api.routes import api_bp

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    
    #Init extenstions
    db.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(app, resources={r"/api*": {"origins": "*"}})

    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/")
    def root():
        return {"status": "ok", "service": "llm-eval-api"}

    return app
