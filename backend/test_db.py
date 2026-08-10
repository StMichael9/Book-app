from sqlalchemy import text
from database import engine, SessionLocal

def test_connection():
    try:
        # Create a session
        session = SessionLocal()
        
        # Run a simple, universal test query
        session.execute(text("SELECT 1"))
        print("✅ Connection successful!")
        
        # Close the session
        session.close()
    except Exception as e:
        print("❌ Connection failed!")
        print(f"Error details: {e}")

if __name__ == "__main__":
    test_connection()
