import json
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .agents import build_reader_agent, build_search_agent, writer_chain, critic_chain

app = FastAPI(title="Relay Research")
STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def sse(event: str, **data) -> str:
    return f"data: {json.dumps({'event': event, **data})}\n\n"


def run_stream(topic: str):
    """Same 4 steps as pipeline.py, but yields progress after every step."""
    try:
        yield sse("step", step=1, status="active")
        search = build_search_agent().invoke(
            {"messages": [("user", f"Find recent, reliable and detailed information about: {topic}")]}
        )
        search_results = search["messages"][-1].content
        yield sse("step", step=1, status="done", preview=search_results[:400])

        yield sse("step", step=2, status="active")
        reader = build_reader_agent().invoke(
            {"messages": [("user",
                f"Based on the following search results about '{topic}', "
                f"pick the most relevant URL and scrape it for deeper content.\n\n"
                f"Search Results:\n{search_results[:800]}")]}
        )
        scraped = reader["messages"][-1].content
        yield sse("step", step=2, status="done", preview=scraped[:400])

        yield sse("step", step=3, status="active")
        research = f"SEARCH RESULTS : \n {search_results} \n\nDETAILED SCRAPED CONTENT : \n {scraped}"
        report = writer_chain.invoke({"topic": topic, "research": research})
        yield sse("step", step=3, status="done", preview=report[:400])

        yield sse("step", step=4, status="active")
        feedback = critic_chain.invoke({"report": report})
        yield sse("step", step=4, status="done", preview=feedback[:400])

        yield sse("done", report=report, feedback=feedback, search=search_results)
    except Exception as e:  # surface errors in the UI
        yield sse("error", message=str(e))


@app.get("/api/research")
def research(topic: str = Query(..., min_length=3, max_length=300)):
    return StreamingResponse(
        run_stream(topic.strip()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


# run:  uvicorn server:app --reload