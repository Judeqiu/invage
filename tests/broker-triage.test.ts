import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createBookkeeperTools } from '../src/tools/index.js';
import {
  archiveBrokerTriage,
  inventoryBrokerRaw,
  listBrokerTriageCases,
  loadBrokerTriageCase,
} from '../src/brokers/triage.js';

const FLEX = `<?xml version="1.0" encoding="UTF-8"?>
<FlexQueryResponse queryName="Activity" type="AF">
  <FlexStatements count="1">
    <FlexStatement accountId="U1234567" fromDate="20260903" toDate="20260903">
      <OpenPositions>
        <OpenPosition accountId="U1234567" symbol="AMD" assetCategory="STK" position="1700" currency="USD" />
      </OpenPositions>
      <CashReport>
        <CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="176625.39" />
      </CashReport>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>`;

describe('inventoryBrokerRaw', () => {
  it('summarizes Flex tags, cash currencies, and position vs quantity', () => {
    const inv = inventoryBrokerRaw(FLEX);
    expect(inv.looks_like).toBe('flex_xml');
    expect(inv.tags.OpenPosition).toBe(1);
    expect(inv.tags.CashReportCurrency).toBe(1);
    expect(inv.cash_currencies).toEqual(['BASE_SUMMARY']);
    expect(inv.position_qty_attr).toBe('position');
    expect(inv.account_id).toBe('U1234567');
  });

  it('flags JSON statements without counting Flex tags', () => {
    const inv = inventoryBrokerRaw(
      JSON.stringify({ schema: 'invage.tiger.raw.v1', positions: { STK: { data: { items: [1, 2] } } } }),
    );
    expect(inv.looks_like).toBe('json');
    expect(inv.position_qty_attr).toBe('none');
    expect(inv.tags['positions.STK']).toBe(2);
    expect(inv.tags.OpenPosition).toBeUndefined();
  });

  it('flags CSV statements', () => {
    const inv = inventoryBrokerRaw(
      `"ClientAccountID","EndingCash"\n"U1","100"\n`,
    );
    expect(inv.looks_like).toBe('csv');
  });
});

describe('archiveBrokerTriage', () => {
  it('writes raw + case.yaml and lists without dumping the body', () => {
    const archived = archiveBrokerTriage({
      slug: 'victor',
      connectorId: 'ibkr',
      body: Buffer.from(FLEX),
      asOf: '2026-09-04',
      error: 'IBKR Flex CashReport is BASE_SUMMARY only',
    });
    expect(existsSync(archived.rawPath)).toBe(true);
    expect(existsSync(archived.casePath)).toBe(true);
    expect(readFileSync(archived.rawPath, 'utf8')).toContain('FlexQueryResponse');
    const loaded = loadBrokerTriageCase(archived.casePath);
    expect(loaded.connector).toBe('ibkr');
    expect(loaded.status).toBe('open');
    expect(loaded.error).toContain('BASE_SUMMARY');
    expect(loaded.inventory.position_qty_attr).toBe('position');
    expect(loaded.inventory.cash_currencies).toEqual(['BASE_SUMMARY']);
    expect(loaded.account_id).toBe('U1234567');
    const listed = listBrokerTriageCases('victor', 'ibkr');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(loaded.id);
    expect(JSON.stringify(listed[0])).not.toContain('<?xml');
    expect(JSON.stringify(listed[0])).not.toContain('endingCash=');
    const parent = join(archived.casePath, '..');
    expect(readdirSync(parent).sort()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^raw\./), 'case.yaml']),
    );
  });
});

describe('Bookkeeper tools', () => {
  it('registers list_broker_triage', () => {
    const names = createBookkeeperTools().map((t) => t.name);
    expect(names).toContain('list_broker_triage');
  });
});
