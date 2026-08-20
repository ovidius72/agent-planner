# @agent-plan/pi-adapter

Pi agent extension for Agent Plan — structured project planning in `.planner/`.

## Install

```bash
pi install npm:@agent-plan/pi-adapter
```

Then restart Pi in a project directory to enable planning.

Check the version actually loaded by Pi:

```text
/planner version
```

From a shell, inspect the installed package directly:

```bash
npm --prefix "$HOME/.pi/agent/npm" list @agent-plan/pi-adapter --depth=0
```

## Commands

Once installed, use `/planner init` to initialize planning in a project,
then `/planner version`, `/planner feature add`, `/planner phase add`, `/planner task add`,
and the lifecycle commands `/planner task start`/`/planner task complete`.

See the [root README](https://github.com/ovidius72/agent-planner#readme) for the full command reference.
