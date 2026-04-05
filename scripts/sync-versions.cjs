const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const pkgPath = path.join(root, "package.json")
const cargoPath = path.join(root, "src-tauri", "Cargo.toml")
const tauriPath = path.join(root, "src-tauri", "tauri.conf.json")

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))
const version = pkg.version

if (!version) {
  console.error("package.json version not found")
  process.exit(1)
}

const cargoText = fs.readFileSync(cargoPath, "utf8")
const nextCargo = cargoText.replace(
  /^(version\\s*=\\s*")([^"]+)(")/m,
  `$1${version}$3`
)
fs.writeFileSync(cargoPath, nextCargo)

const tauriConfig = JSON.parse(fs.readFileSync(tauriPath, "utf8"))
tauriConfig.version = version
fs.writeFileSync(tauriPath, JSON.stringify(tauriConfig, null, 2) + "\n")

console.log(`Synced Cargo.toml and tauri.conf.json to version ${version}`)
