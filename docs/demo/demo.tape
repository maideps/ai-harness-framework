# README demo GIF, recorded with VHS (https://github.com/charmbracelet/vhs), version 0.8 or newer.
#
# Run from the root of this repository, on Linux, macOS or WSL (VHS needs ttyd and ffmpeg):
#
#   vhs docs/demo/demo.tape
#
# It writes docs/demo/demo.gif. Then replace the "Demo GIF goes here" comment in README.md
# with the image link that comment gives.
#
# What it shows: create-harness adds the harness to a new project, WIP=1 refuses a second
# active feature, the verification gate refuses a failing test, and passes after the fix.
# Everything runs in a temporary folder; this repository is only read (git clone of it).
#
# Only setup is hidden: filling in the three docs that create-harness asks you to fill, git
# commits, and writing the demo's code and test. Every command shown runs in real time.

Output docs/demo/demo.gif

Require git
Require node
Require npm

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 20
Set TypingSpeed 35ms
Set Theme "Catppuccin Mocha"

# --- Setup (hidden): a clean temporary folder with a copy of this repository -----------------
Hide
Type 'export FRAMEWORK="$PWD" PS1="\[\e[1;36m\]$ \[\e[0m\]" && cd "$(mktemp -d)" && git clone -q "$FRAMEWORK" ai-harness-framework && clear'
Enter
Sleep 3s
Show

# --- 1. Add the harness to a project ----------------------------------------------------------
Type "node ai-harness-framework/scripts/create-harness.mjs my-app"
Sleep 400ms
Enter
Sleep 3s

# Hidden: fill in the docs create-harness asks for, and commit the starting point.
Hide
Type `cd my-app && printf '# My App\n\nA demo project.\n\nCommands: [Harness Command Reference](docs/HARNESS.md)\n' > README.md && printf '# Product\n\nA demo project.\n' > docs/PRODUCT.md && printf '# Quality\n\nNothing rated yet.\n' > docs/quality-document.md && git init -q && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm 'Adopt the harness' && clear`
Enter
Sleep 3s
Show

# --- 2. Declare a feature with its own test, and start it --------------------------------------
Type `npm run -s add-feature -- feat-002 "Greeting" --behavior "greet() returns hi" --layer "Layer 2b: App tests=node --test app/greet.test.mjs"`
Sleep 400ms
Enter
Sleep 1500ms
Type "npm run -s activate -- feat-002"
Sleep 400ms
Enter
Sleep 1500ms

# --- 3. WIP=1: a second feature can't start until this one passes ------------------------------
Type "npm run -s activate -- feat-001"
Sleep 400ms
Enter
Sleep 2500ms

# Hidden: the "agent's" first attempt, with a bug its test catches.
Hide
Type `mkdir -p app && printf 'export const greet = () => "hello";\n' > app/greet.mjs && printf 'import test from "node:test";\nimport assert from "node:assert";\nimport { greet } from "./greet.mjs";\ntest("greet() returns hi", () => assert.equal(greet(), "hi"));\n' > app/greet.test.mjs && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm 'Add greet' && clear`
Enter
Sleep 2s
Show

# --- 4. The agent says it's done. The gate checks. ---------------------------------------------
Type "# The agent says feat-002 is done. The gate checks:"
Enter
Sleep 800ms
Type "npm run -s verify-feature -- feat-002"
Sleep 400ms
Enter
# Wait until the run ends: the last line is the prompt again.
Wait+Line@1m /^\$ ?$/
Sleep 5s

# Hidden: the fix.
Hide
Type `printf 'export const greet = () => "hi";\n' > app/greet.mjs && git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm 'Fix greet' && clear`
Enter
Sleep 2s
Show

# --- 5. After the fix, the gate passes and records the evidence --------------------------------
Type "# After the fix:"
Enter
Sleep 800ms
Type "npm run -s verify-feature -- feat-002"
Sleep 400ms
Enter
Wait+Line@1m /^\$ ?$/
Sleep 6s
