# AGENTS.md

This file provides configuration and context for AI coding agents.

## bg-tasks Background Task Management

When you need to start, monitor, or stop background processes (dev servers, builds, tests), use the `bg-tasks` MCP tools:

### Available Tools

| Tool | Purpose |
|------|---------|
| `bg_start` | Start a background task (name, command) |
| `bg_wait` | Wait for task completion or timeout |
| `bg_logs` | Read task output (tail, stream) |
| `bg_status` | Inspect task status or list all tasks |
| `bg_send` | Send text or signal to running task |
| `bg_kill` | Terminate a task |

### Available Resources

| Resource | Description |
|----------|-------------|
| `bg://status` | All tasks as JSON |
| `bg://{id}/status` | Single task detail + log summary |
| `bg://{id}/logs` | Combined stdout/stderr |
| `bg://{id}/logs/stdout` | stdout only |
| `bg://{id}/logs/stderr` | stderr only |

### Usage Patterns

```
# Start frontend and backend services
bg_start(name="frontend", command="npm run dev")
bg_start(name="backend", command="python app.py")

# Wait for startup and check logs
bg_wait(id="frontend", timeout=10) → bg_logs(id="frontend", tail=10)

# Check status
bg_status() → list all tasks
bg_status(id="frontend") → check single task

# Stop
bg_kill(id="frontend")
bg_kill(id="backend", force=true)  # force SIGKILL
```

### Web Dashboard

`http://127.0.0.1:9876` — Real-time view of all windows' tasks with logs.
`http://127.0.0.1:9876/?lang=zh` — Chinese UI.