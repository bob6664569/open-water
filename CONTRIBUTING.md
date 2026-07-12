# Contributing

Thanks for helping improve Open Water. Keep changes focused: visual and physics
systems are tightly coupled, so small pull requests are easier to validate and
less likely to introduce subtle runtime regressions.

## Development setup

Requirements:

- Node.js 22 or newer
- Docker and Docker Compose for the local web server
- Python 3.12 or newer for the optional GLB texture tool

Install the validation tools:

```sh
npm ci
python3 -m pip install -r requirements-tools.txt
```

Start the application:

```sh
docker compose up
```

Then open <http://localhost:8930>.

## Before opening a pull request

Run the same checks as CI:

```sh
npm run check
python3 -m ruff check tools
python3 -m py_compile tools/glb_shrink.py
```

For rendering, physics, input, audio, or fauna changes, also test the affected
sea state and at least one desktop browser. Test a touch device or emulation when
changing startup, memory use, controls, or quality adaptation.

Pull requests should explain the user-visible outcome, how it was verified, and
any asset or performance impact. Avoid unrelated formatting or broad refactors.

## Adding assets

Do not add media unless its redistribution terms are known and compatible with
the intended use of the repository. In particular:

- never add files whose license forbids standalone redistribution;
- call out non-commercial or share-alike restrictions before adding them;
- retain author, source URL, license, and modification details in GLB metadata;
- update `THIRD_PARTY_NOTICES.md` or `site/assets/audio/LICENSES.md`;
- create a mobile variant for boat textures above 1024 by 1024 pixels.

Large assets should be justified in the pull request and checked for an unused
or lower-resolution equivalent first.
