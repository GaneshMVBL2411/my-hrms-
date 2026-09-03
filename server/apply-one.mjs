import { readFileSync } from "node:fs"
import pg from "pg"
const env = {}
for (const l of readFileSync("./.env","utf8").split("\n")) { const i=l.indexOf("="); if(i>0&&!l.startsWith("#")) env[l.slice(0,i).trim()]=l.slice(i+1).trim() }
// Applied as the owner: creating SECURITY DEFINER functions requires it, and
// the owner is what those functions then run as.
const pool = new pg.Pool({ connectionString: env.DATABASE_URL_OWNER, ssl:{rejectUnauthorized:true}, max:1 })
const sql = readFileSync(process.argv[2], "utf8")
const res = await pool.query(sql)
const last = Array.isArray(res) ? res[res.length-1] : res
if (last?.rows?.length) console.table(last.rows)
console.log("applied:", process.argv[2])
await pool.end()
