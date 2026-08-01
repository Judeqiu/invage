/**
 * ura_carpark — URA car park availability and rates/details.
 *
 * Requires URA_ACCESS_KEY. Uses eservice.ura.gov.sg Data Service API.
 */

import { Type } from 'typebox';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  fetchCarParkAvailability,
  fetchCarParkDetails,
  fetchUraToken,
  getUraAccessKey,
  type UraCarParkAvailability,
  type UraCarParkDetail,
} from '../market/ura-client.js';

type Action = 'availability' | 'details' | 'lookup';

interface Params {
  action: Action;
  /** Car park code e.g. A0004 / S0049 (matches ppCode or carparkNo). */
  carpark_no?: string;
  /** Name substring e.g. ORCHARD, ALIWAL. */
  name?: string;
  /** Lot type filter for availability: C / Y / H / M … */
  lot_type?: string;
  /** Vehicle category for details: Car, Heavy Vehicle, Motorcycle, … */
  veh_cat?: string;
  limit?: number;
}

function ok<T>(text: string, details: T): AgentToolResult<T> {
  return { content: [{ type: 'text' as const, text }], details };
}
function fail(text: string): AgentToolResult<null> {
  return { content: [{ type: 'text' as const, text }], details: null };
}

function includesCI(hay: string, needle: string): boolean {
  return hay.toUpperCase().includes(needle.trim().toUpperCase());
}

function formatAvailability(rows: UraCarParkAvailability[]): string {
  if (rows.length === 0) return 'No matching car park availability rows.';
  return rows
    .map((r) => {
      const coords = r.geometries?.[0]?.coordinates ?? '';
      return `- ${r.carparkNo} | lotType=${r.lotType} | lotsAvailable=${r.lotsAvailable}` +
        (coords ? ` | coords=${coords}` : '');
    })
    .join('\n');
}

function formatDetails(rows: UraCarParkDetail[]): string {
  if (rows.length === 0) return 'No matching car park detail rows.';
  return rows
    .map((r) => {
      const coords = r.geometries?.[0]?.coordinates ?? '';
      return (
        `- ${r.ppCode} | ${r.ppName.trim()} | veh=${r.vehCat ?? '?'} | system=${r.parkingSystem ?? '?'} | ` +
        `cap=${r.parkCapacity ?? '?'} | weekday=${r.weekdayRate ?? '?'} / ${r.weekdayMin ?? '?'} | ` +
        `sat=${r.satdayRate ?? '?'} | sunPH=${r.sunPHRate ?? '?'} | hours ${r.startTime ?? '?'}–${r.endTime ?? '?'}` +
        (coords ? ` | coords=${coords}` : '')
      );
    })
    .join('\n');
}

export function createUraCarparkTool(): AgentTool {
  return {
    name: 'ura_carpark',
    label: 'URA Car Park',
    description:
      'Query URA car parks: live lot availability (Car_Park_Availability) and rates/details (Car_Park_Details). ' +
      'Requires URA_ACCESS_KEY. action=availability | details | lookup (join both by code). ' +
      'Filter by carpark_no / name / lot_type / veh_cat. Do not invent availability or rates.',
    parameters: Type.Object({
      action: Type.Union(
        [Type.Literal('availability'), Type.Literal('details'), Type.Literal('lookup')],
        {
          description:
            'availability = live lots; details = rates/capacity/name; lookup = both joined by code',
        },
      ),
      carpark_no: Type.Optional(
        Type.String({ description: 'Car park code e.g. A0004, S0049 (ppCode / carparkNo)' }),
      ),
      name: Type.Optional(
        Type.String({ description: 'Name substring on ppName (details/lookup)' }),
      ),
      lot_type: Type.Optional(
        Type.String({ description: 'Availability lot type filter e.g. C, Y, H, M' }),
      ),
      veh_cat: Type.Optional(
        Type.String({ description: 'Details vehicle category filter e.g. Car' }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Max rows (1–100, default 25)' }),
      ),
    }),
    execute: async (_id, raw) => {
      try {
        const p = raw as Params;
        if (!p.action) throw new Error('action is required (availability | details | lookup)');
        getUraAccessKey(); // fail-fast early

        const want = Math.min(Math.max(p.limit ?? 25, 1), 100);
        const accessKey = getUraAccessKey();
        const token = await fetchUraToken(accessKey);

        if (p.action === 'availability') {
          let rows = await fetchCarParkAvailability({ accessKey, token });
          if (p.carpark_no) {
            rows = rows.filter((r) => includesCI(r.carparkNo, p.carpark_no!));
          }
          if (p.lot_type) {
            rows = rows.filter((r) => includesCI(r.lotType, p.lot_type!));
          }
          const sample = rows.slice(0, want);
          const text = [
            'Source: URA Car_Park_Availability (eservice.ura.gov.sg)',
            `Matched: ${rows.length} | returned: ${sample.length}`,
            '',
            formatAvailability(sample),
          ].join('\n');
          return ok(text, {
            action: p.action,
            matched: rows.length,
            count: sample.length,
            rows: sample,
          });
        }

        if (p.action === 'details') {
          let rows = await fetchCarParkDetails({ accessKey, token });
          if (p.carpark_no) {
            rows = rows.filter((r) => includesCI(r.ppCode, p.carpark_no!));
          }
          if (p.name) {
            rows = rows.filter((r) => includesCI(r.ppName, p.name!));
          }
          if (p.veh_cat) {
            rows = rows.filter((r) => includesCI(r.vehCat || '', p.veh_cat!));
          }
          const sample = rows.slice(0, want);
          const text = [
            'Source: URA Car_Park_Details (eservice.ura.gov.sg)',
            `Matched: ${rows.length} | returned: ${sample.length}`,
            '',
            formatDetails(sample),
          ].join('\n');
          return ok(text, {
            action: p.action,
            matched: rows.length,
            count: sample.length,
            rows: sample,
          });
        }

        // lookup — join availability + details
        const [avail, details] = await Promise.all([
          fetchCarParkAvailability({ accessKey, token }),
          fetchCarParkDetails({ accessKey, token }),
        ]);
        const availByCode = new Map(avail.map((a) => [a.carparkNo.toUpperCase(), a]));

        let det = details;
        if (p.carpark_no) det = det.filter((r) => includesCI(r.ppCode, p.carpark_no!));
        if (p.name) det = det.filter((r) => includesCI(r.ppName, p.name!));
        if (p.veh_cat) det = det.filter((r) => includesCI(r.vehCat || '', p.veh_cat!));

        const joined = det.map((d) => {
          const a = availByCode.get(d.ppCode.toUpperCase());
          return {
            ppCode: d.ppCode,
            ppName: d.ppName.trim(),
            vehCat: d.vehCat,
            parkCapacity: d.parkCapacity,
            weekdayRate: d.weekdayRate,
            lotsAvailable: a?.lotsAvailable ?? null,
            lotType: a?.lotType ?? null,
            hasLiveAvailability: a != null,
          };
        });

        let rows = joined;
        if (p.lot_type) {
          rows = rows.filter((r) => r.lotType != null && includesCI(String(r.lotType), p.lot_type!));
        }
        const sample = rows.slice(0, want);
        const lines = sample.map(
          (r) =>
            `- ${r.ppCode} | ${r.ppName} | veh=${r.vehCat ?? '?'} | cap=${r.parkCapacity ?? '?'} | ` +
            `weekday=${r.weekdayRate ?? '?'} | lotsAvailable=${r.lotsAvailable ?? 'n/a'} | lotType=${r.lotType ?? 'n/a'}`,
        );
        const text = [
          'Source: URA Car_Park_Details + Car_Park_Availability (joined on code)',
          `Matched: ${rows.length} | returned: ${sample.length}`,
          '',
          lines.join('\n') || 'No matching car parks.',
        ].join('\n');
        return ok(text, {
          action: 'lookup',
          matched: rows.length,
          count: sample.length,
          rows: sample,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[ura_carpark]', message);
        return fail(`ura_carpark failed: ${message}`);
      }
    },
  };
}
