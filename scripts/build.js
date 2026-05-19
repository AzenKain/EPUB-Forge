import { execSync } from "child_process";
import fs from "fs";
import path from "path";

console.log("Building frontend...");
try {
  execSync("npm run build", { stdio: "inherit" });
} catch (error) {
  console.error("Frontend build failed.");
  process.exit(1);
}

const distDir = "dist-native";
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const targets = {
  windows: [
    { GOOS: "windows", GOARCH: "amd64", filename: "epubforge-windows-amd64.exe" },
    { GOOS: "windows", GOARCH: "arm64", filename: "epubforge-windows-arm64.exe" }
  ],
  mac: [
    { GOOS: "darwin", GOARCH: "amd64", filename: "epubforge-darwin-amd64" },
    { GOOS: "darwin", GOARCH: "arm64", filename: "epubforge-darwin-arm64" }
  ],
  linux: [
    { GOOS: "linux", GOARCH: "amd64", filename: "epubforge-linux-amd64" },
    { GOOS: "linux", GOARCH: "arm64", filename: "epubforge-linux-arm64" }
  ]
};

const argTarget = process.argv[2] || "all";

function buildBinary(config) {
  const outputPath = path.join(distDir, config.filename);
  console.log(`Building for OS=${config.GOOS} Arch=${config.GOARCH} -> ${outputPath}...`);

  try {
    execSync(`go build -trimpath -ldflags="-s -w" -o "${outputPath}" ./cmd/epubforge`, {
      env: {
        ...process.env,
        GOOS: config.GOOS,
        GOARCH: config.GOARCH
      },
      stdio: "inherit"
    });
    console.log(`Successfully built ${config.filename}`);
  } catch (error) {
    console.error(`Failed to build for OS=${config.GOOS} Arch=${config.GOARCH}:`, error.message);
    process.exit(1);
  }
}

if (argTarget === "all") {
  for (const platform of Object.keys(targets)) {
    for (const config of targets[platform]) {
      buildBinary(config);
    }
  }
} else if (targets[argTarget]) {
  for (const config of targets[argTarget]) {
    buildBinary(config);
  }
} else {
  console.error(`Unknown build target: "${argTarget}". Use: windows, mac, linux, or all.`);
  process.exit(1);
}

console.log("Build processes completed successfully!");
