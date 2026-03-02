import os
from dotenv import load_dotenv

load_dotenv()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
PORT = int(os.getenv("PORT", "8000"))

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# insAIghts table namespace (avoid collisions with other apps sharing one Supabase project)
USERS_TABLE = os.getenv("USERS_TABLE", "insaights_users")
ADMIN_AUDIT_TABLE = os.getenv("ADMIN_AUDIT_TABLE", "insaights_admin_audit_log")
CONNECTORS_TABLE = os.getenv("CONNECTORS_TABLE", "insaights_config_connectors")
DOCUMENTS_TABLE = os.getenv("DOCUMENTS_TABLE", "insaights_documents")
PROVIDER_KEYS_TABLE = os.getenv("PROVIDER_KEYS_TABLE", "insaights_config_provider_keys")
INVOICES_TABLE = os.getenv("INVOICES_TABLE", "insaights_invoices")
INVOICE_LINES_TABLE = os.getenv("INVOICE_LINES_TABLE", "insaights_invoice_lines")
INVOICE_ACTIONS_TABLE = os.getenv("INVOICE_ACTIONS_TABLE", "insaights_invoice_actions")
EXTRACTION_FIELDS_TABLE = os.getenv("EXTRACTION_FIELDS_TABLE", "insaights_config_extraction_fields")

# Bootstrap admin (explicitly required by project decisions).
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# Graph DB
GRAPH_DB_URI = os.getenv("GRAPH_DB_URI", "bolt://neo4j:7687")
GRAPH_DB_USER = os.getenv("GRAPH_DB_USER", "neo4j")
GRAPH_DB_PASSWORD = os.getenv("GRAPH_DB_PASSWORD", "")
