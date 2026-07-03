import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "node:fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "dotenv",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "resend",
  "twilio",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.ADMIN_PASSWORD": '"colonyfinance2026"',
      "process.env.TWILIO_ACCOUNT_SID": '"ACdc7f2d2d72c9b5067e72e4265e9e0379"',
      "process.env.TWILIO_AUTH_TOKEN": '"fe74d085552de5e41501ba1b80c81f4f"',
      "process.env.TWILIO_FROM_NUMBER": '"+12294595317"',
      "process.env.PPLX_API_KEY": '"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"',
      "process.env.RESEND_API_KEY": '"re_YDb8ZmEv_JEQ6KaabhAJCE2fM3itrwaRo"',
    },
    minify: false,
    external: externals,
    logLevel: "info",
  });

  // Write minimal production package.json so the sandbox only installs what's needed
  await writeFile("dist/package.json", JSON.stringify({
    name: "colony-city-finance",
    version: "1.0.0",
    dependencies: { openai: "^6.45.0" }
  }, null, 2));
  console.log("dist/package.json written");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
