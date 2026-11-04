import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';
const context = createContext({});
new Script(readFileSync(new URL('../../webui/portfolio-wire.js',import.meta.url),'utf8')).runInContext(context);
export const portfolioWire: {encode(value: unknown): unknown;decode(value: unknown): unknown} = context.PortfolioWire;
