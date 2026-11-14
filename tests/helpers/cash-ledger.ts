import type { TigerRawBundle } from '../../src/tiger/tiger-types.js';

/** Synthetic, account-bound native Tiger shape; no production customer data. */
export function tigerLedgerBundle(): TigerRawBundle {
  return {schema:'invage.tiger.raw.v1',account:'A',license:'TBSG',account_kind:'prime',fetched_at:'2026-11-14T08:00:00.000Z',
    gateway:'https://openapi.tigerfintech.com/gateway',managed_accounts:null,
    assets:{method:'prime_assets',envelope:{code:0,data:{account:'A',segments:{S:{currencyAssets:{USD:{cashBalance:'500'}}}}}}},
    positions:{STK:{code:0,data:{items:[]}},OPT:{code:0,data:{items:[]}},FUND:{code:0,data:{items:[]}}},
    history:{start:Date.parse('2025-01-01T00:00:00Z'),end:Date.parse('2026-11-14T08:00:00Z'),mode:'full',orders:[],transactions:[],gaps:[],fund_details:{
      from:'2025-01-01T00:00:00.000Z',through:'2026-11-14T08:00:00.000Z',segments:['SEC','FUT','FUND'],complete:true,rows:[
        {id:'9007199254740993123',segType:'SEC',businessDate:'2025-11-10',currency:'USD',amount:'1000.1234567890123456789',type:'Deposit',desc:'Broker reference',updatedAt:'1760000000000'},
        {id:'fee',segType:'SEC',businessDate:'2025-11-10',currency:'USD',amount:'-1.20',type:'Commission'},
        {id:'rebate',segType:'SEC',businessDate:'2025-11-10',currency:'USD',amount:'0.20',type:'Unfamiliar broker type'},
        {id:'zero',segType:'FUND',businessDate:'2026-11-13',currency:'SGD',amount:'0.00',type:'Fund Subscription'},
      ],
    }},
  };
}
