/**
 * Generate iot-knowledge/kbit.schema.json from the canonical zod schema.
 * Run: npm run gen:kbit-schema   (CI verifies the output is in sync).
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { zodToJsonSchema } from "zod-to-json-schema"
import { kbitMetaSchema } from "../src/services/knowledge/kbit/schema"

const jsonSchema = zodToJsonSchema(kbitMetaSchema, {
	name: "KBitMeta",
	$refStrategy: "none",
})

const outPath = join(__dirname, "..", "iot-knowledge", "kbit.schema.json")
writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, "\t")}\n`, "utf8")
console.log(`Generated ${outPath}`)
