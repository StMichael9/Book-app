import asyncio
from fastapi import FastAPI

app = FastAPI()

@app.get('/health')
def health_check():
    return {"Healthy"}, 200

@app.get('/async')
async def async_endpoint():
    await asyncio.sleep(1)
    return {"status": "non-blocking and fast"}
