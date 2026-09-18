# ChadContext

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![AWS](https://img.shields.io/badge/AWS-Serverless-orange)
![MCP](https://img.shields.io/badge/MCP-Stdio-green)
![pnpm](https://img.shields.io/badge/pnpm-11.x-yellow)

An AI-powered team context engine that answers **"why does this code exist?"** by tracing codebase decisions through a causal graph (GitHub Issues → Discord debates → Pull Requests → Code).

It uses an event-driven AWS serverless pipeline, stores relationships in a DynamoDB single-table design, and exposes the data via an MCP (Model Context Protocol) server.

## Setup & Installation

Scaffold the workspace, install dependencies, approve local build scripts, and set up directories:

```bash
pnpm init
pnpm add discord.js @aws-sdk/client-s3 dotenv
pnpm add -D typescript @types/node tsx
pnpm approve-builds
pnpm exec tsc --init
mkdir -p scripts shared
```

## Configuration Files

### tsconfig.json setup

The compiler is configured to output to a `dist/` folder using NodeNext module resolution. The included directories are `scripts/**/*`, `shared/**/*`, `lambdas/**/*`, and `infra/**/*`.

```json
{
  "compilerOptions": {
    "outDir": "./dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["scripts/**/*", "shared/**/*", "lambdas/**/*", "infra/**/*"]
}
```

### Environment Variables (.env)

Copy `.env.example` to `.env` and fill in your values:

```bash
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=
AWS_REGION=us-east-1
S3_BUCKET_NAME=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

Required keys:

- `DISCORD_TOKEN`
- `DISCORD_CHANNEL_ID`
- `AWS_REGION=us-east-1`
- `S3_BUCKET_NAME`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Building the Project

Compile the TypeScript codebase into executable JavaScript for the MCP server:

```bash
pnpm exec tsc
```

This emits `dist/scripts/mcp-server.js` used by Claude Desktop below.

## Claude Desktop Configuration

Register the MCP server with Claude Desktop by adding this block to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chadcontext": {
      "command": "node",
      "args": [
        "/ABSOLUTE_PATH_TO_YOUR_PROJECT/ChadContext/dist/scripts/mcp-server.js"
      ],
      "env": {
        "AWS_REGION": "us-east-1",
        "TABLE_NAME": "ChadContextGraph",
        "AWS_ACCESS_KEY_ID": "YOUR_AWS_ACCESS_KEY",
        "AWS_SECRET_ACCESS_KEY": "YOUR_AWS_SECRET_KEY"
      }
    }
  }
}
```

> **WARNING 1:** You must replace `/ABSOLUTE_PATH_TO_YOUR_PROJECT/` with the actual path on your local machine.
>
> **SECURITY WARNING:** Never commit the `claude_desktop_config.json` file to source control, as it contains live, unencrypted AWS access credentials.

## Restarting & Testing

Verify the server is working:

1. Force-quit Claude in the terminal:

```bash
killall Claude
```

2. Open the Claude Desktop application.

3. Test the integration by pasting this exact prompt:

```text
"Use the ChadContext tool to tell me why PR 482 exists."
```
