import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEED_CASES } from './fixtures.js';
export const now = () => new Date().toISOString();
export class LabStore {
  constructor(path) {
    if(path !== ':memory:') mkdirSync(dirname(path),{recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS lab_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_customers (id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_conversations (id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_runs (id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_feedback (id TEXT PRIMARY KEY,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_cases (id TEXT PRIMARY KEY,json TEXT NOT NULL);`);
    this.db.prepare('INSERT OR IGNORE INTO lab_meta VALUES (?,?)').run('schema_version','1');
    if (!this.get('customers','test-default')) this.put('customers',{id:'test-default',name:'Chị khách test',profile:'',created_at:now()});
    for(const c of SEED_CASES) if(!this.get('cases',c.id)) this.put('cases',{...c,created_at:now()});
  }
  table(name) {if(!['customers','conversations','runs','feedback','cases'].includes(name))throw new Error('Unknown Lab table');return `lab_${name}`;}
  get(name,id) {const row=this.db.prepare(`SELECT json FROM ${this.table(name)} WHERE id=?`).get(id);return row?JSON.parse(row.json):null;}
  list(name) {return this.db.prepare(`SELECT json FROM ${this.table(name)} ORDER BY rowid DESC`).all().map(row=>JSON.parse(row.json));}
  put(name,value) {this.db.prepare(`INSERT INTO ${this.table(name)} (id,json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`).run(value.id,JSON.stringify(value));return value;}
  atomic(fn) {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  customer(name,profile) {return this.put('customers',{id:randomUUID(),name,profile,created_at:now()});}
  conversation(customer,entry) {return this.put('conversations',{id:randomUUID(),customer,entry,history:[],memory:[],run_ids:[],created_at:now(),updated_at:now(),revision:0});}
  close(){this.db.close();}
}
