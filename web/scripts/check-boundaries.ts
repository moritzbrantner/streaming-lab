import {readdir, readFile} from "node:fs/promises"
import {join, relative} from "node:path"

const libRoot = new URL("../lib/", import.meta.url)
const forbiddenPrefixes = ["react", "react-dom", "next", "@/components", "@/app"]

async function sourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, {withFileTypes: true})
  const files: URL[] = []

  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory)
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(child))
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(child)
    }
  }

  return files
}

function importsFrom(source: string): string[] {
  const matches = source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)
  return [...matches].map((match) => match[1])
}

function isForbidden(specifier: string): boolean {
  return forbiddenPrefixes.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`))
}

const violations: string[] = []

for (const file of await sourceFiles(libRoot)) {
  const source = await readFile(file, "utf8")
  for (const specifier of importsFrom(source)) {
    if (isForbidden(specifier)) {
      const path = relative(new URL("../", import.meta.url).pathname, file.pathname)
      violations.push(`${path}: deterministic library code imports ${specifier}`)
    }
  }
}

if (violations.length > 0) {
  console.error("Streaming model boundary violations:\n" + violations.map((violation) => `- ${violation}`).join("\n"))
  process.exit(1)
}

console.log("Streaming model boundaries are clean")
