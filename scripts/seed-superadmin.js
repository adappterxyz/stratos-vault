#!/usr/bin/env node

/**
 * Seed Superadmin User Script
 *
 * Usage: node scripts/seed-superadmin.js <database-name> <username> <password>
 *
 * This script creates an initial superadmin user in the D1 database.
 * Run this after creating the database and applying the schema.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function promptPassword(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Try to hide input
  process.stdout.write(question);
  return new Promise(resolve => {
    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        rl.close();
        resolve(password);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007F') {
        password = password.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(question + '*'.repeat(password.length));
      } else {
        password += char;
        process.stdout.write('*');
      }
    };

    process.stdin.on('data', onData);
  });
}

function hashPassword(password) {
  // Must match app's algorithm: PBKDF2 with SHA-256, 32 bytes output
  const salt = crypto.randomBytes(16);
  const saltHex = salt.toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${saltHex}:${hash}`;
}

function generateUUID() {
  return crypto.randomUUID();
}

async function main() {
  console.log('');
  console.log('===========================================');
  console.log('  Cloudflare Wallet - Superadmin Seeder');
  console.log('===========================================');
  console.log('');

  let dbName = process.argv[2];
  let username = process.argv[3];
  let password = process.argv[4];

  // Interactive prompts if not provided via CLI
  if (!dbName) {
    dbName = await prompt('D1 Database name: ');
  }
  if (!username) {
    username = await prompt('Superadmin username: ');
  }
  if (!password) {
    password = await promptPassword('Superadmin password: ');
  }

  if (!dbName || !username || !password) {
    console.error('Error: Database name, username, and password are required.');
    process.exit(1);
  }

  console.log('');
  console.log(`Creating superadmin user "${username}" in database "${dbName}"...`);

  const userId = generateUUID();
  const passwordHash = hashPassword(password);

  // Escape single quotes in values
  const escapedUsername = username.replace(/'/g, "''");
  const escapedHash = passwordHash.replace(/'/g, "''");

  const sql = `INSERT INTO superadmin_users (id, username, password_hash, is_superadmin, display_name) VALUES ('${userId}', '${escapedUsername}', '${escapedHash}', 1, 'Super Admin');`;

  try {
    execSync(`wrangler d1 execute "${dbName}" --remote --command="${sql}"`, {
      stdio: 'inherit'
    });
    console.log('');
    console.log('Superadmin user created successfully!');
    console.log(`Username: ${username}`);
    console.log('');
  } catch (error) {
    console.error('Failed to create superadmin user.');
    console.error('You may need to run the command manually:');
    console.error(`wrangler d1 execute "${dbName}" --remote --command="${sql}"`);
    process.exit(1);
  }
}

main().catch(console.error);
