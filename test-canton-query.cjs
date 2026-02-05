// Direct Canton query test - bypasses all the app layers
const jwt = require('jsonwebtoken');

// Configuration - update these values
const CANTON_HOST = 'p1-json.cantondefi.com';
const AUTH_SECRET = process.env.CANTON_AUTH_SECRET || 'your-secret-here';
const PUBLIC_PARTY = 'publicParty::1220c5be6fa9be9256b5e8c8b219ae838c9dae9f5785de8773c049cbb2035464c2a8';
const TEMPLATE_ID = 'a1a1e4de62c91e39988cf31883400a55ed7c1176d536d199de98b813bda00347:RWAAsset:RWAAsset';

async function main() {
  // Generate JWT token
  const token = jwt.sign(
    {
      aud: 'https://canton.network.global',
      sub: 'ledger-api-user',
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    AUTH_SECRET,
    { algorithm: 'HS256' }
  );

  console.log('Testing Canton query...');
  console.log('Host:', CANTON_HOST);
  console.log('Template:', TEMPLATE_ID);
  console.log('Party:', PUBLIC_PARTY);

  // Step 1: Get ledger end (GET request)
  const ledgerEndRes = await fetch(`https://${CANTON_HOST}/v2/state/ledger-end`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!ledgerEndRes.ok) {
    console.error('Ledger end failed:', await ledgerEndRes.text());
    return;
  }

  const ledgerEnd = await ledgerEndRes.json();
  console.log('\nLedger end:', ledgerEnd);

  // Step 2: Query active contracts
  const queryBody = {
    filter: {
      filtersByParty: {
        [PUBLIC_PARTY]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: {
                  templateId: TEMPLATE_ID,
                  includeCreatedEventBlob: false
                }
              }
            }
          }]
        }
      }
    },
    verbose: true,
    activeAtOffset: ledgerEnd.offset
  };

  console.log('\nQuery body:', JSON.stringify(queryBody, null, 2));

  const queryRes = await fetch(`https://${CANTON_HOST}/v2/state/active-contracts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(queryBody)
  });

  console.log('\nResponse status:', queryRes.status);

  if (!queryRes.ok) {
    console.error('Query failed:', await queryRes.text());
    return;
  }

  const result = await queryRes.json();
  console.log('\nResult type:', typeof result);
  console.log('Is array:', Array.isArray(result));
  console.log('Count:', Array.isArray(result) ? result.length : 'N/A');

  if (Array.isArray(result) && result.length > 0) {
    console.log('\nFirst contract:', JSON.stringify(result[0], null, 2).slice(0, 500));
  } else {
    console.log('\nRaw result:', JSON.stringify(result).slice(0, 1000));
  }
}

main().catch(console.error);
