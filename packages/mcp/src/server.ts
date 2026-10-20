#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './index.js';

// stdout carries the protocol, so anything human-readable goes to stderr.
await createServer().connect(new StdioServerTransport());
process.stderr.write('fastforward-mcp ready on stdio\n');
