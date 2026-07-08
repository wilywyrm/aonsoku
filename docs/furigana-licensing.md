# Furigana Data Licensing

> **Not legal advice.** This document is a maintainer reference to track attribution obligations and confirm release readiness. Consult a lawyer for legal questions.

---

## License summary

| Component | License | Notes |
|-----------|---------|-------|
| aonsoku app code | MIT | See `LICENSE.txt` |
| `JmdictFurigana.json` | CC BY-SA 4.0 | Derived from JMdict; ShareAlike applies |
| JMdict / JMnedict | CC BY-SA 4.0 | Source dictionary data |

---

## How the licenses coexist

aonsoku's source code is MIT. `JmdictFurigana.json` is a **separate, unmodified data asset** distributed alongside the app. It is not compiled into the application binary, not merged into source files, and not modified in any way.

This arrangement is commonly called **mere aggregation**: the data file and the app code are distributed together for convenience, but they remain distinct works under their respective licenses. The MIT license covers the app code; CC BY-SA 4.0 covers the data asset. Neither license is applied to the other work.

Because the data is shipped unmodified and kept separate, the ShareAlike clause of CC BY-SA 4.0 does not propagate to the MIT-licensed app code. The data itself, however, remains CC BY-SA 4.0 and must be attributed and redistributed under those terms.

---

## Attribution

### JMdict / JMnedict

- **Copyright:** Electronic Dictionary Research and Development Group (EDRDG)
- **License:** Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
- **License deed:** <https://creativecommons.org/licenses/by-sa/4.0/>
- **Source:** <https://www.edrdg.org/>

### jmdict-furigana (`JmdictFurigana.json`)

- **Author:** Doublevil
- **License:** CC BY-SA 4.0 (derived from JMdict, ShareAlike terms inherited)
- **License deed:** <https://creativecommons.org/licenses/by-sa/4.0/>
- **Source:** <https://github.com/Doublevil/JmdictFurigana>

Full attribution is also recorded in the `NOTICE` file at the repo root and should be surfaced in the app's About screen.

---

## Pre-release sign-off

This checklist must be reviewed by a maintainer before any release that ships `JmdictFurigana.json`. Check each box to confirm the release meets CC BY-SA 4.0 obligations.

> **Reminder:** This is a maintainer checklist, NOT legal advice.

- [ ] `JmdictFurigana.json` is shipped **unmodified** as a standalone asset. It has not been merged into source files or compiled into the app binary.
- [ ] No dataset content is embedded under `src/`. Verify with: `grep -r "furigana" src/ --include="*.json"` returning no hits on the data file itself.
- [ ] Attribution for JMdict/JMnedict (EDRDG, CC BY-SA 4.0) is present in `NOTICE`.
- [ ] Attribution for jmdict-furigana (Doublevil, CC BY-SA 4.0) is present in `NOTICE`.
- [ ] Attribution is surfaced to end users in the app's About screen or equivalent UI.
- [ ] The distributed build includes `NOTICE` (or equivalent attribution document) accessible to users.
- [ ] Maintainer has read the CC BY-SA 4.0 deed (<https://creativecommons.org/licenses/by-sa/4.0/>) and accepts its ShareAlike terms for the distributed build.
- [ ] If `JmdictFurigana.json` was updated, the new version's license status was confirmed before inclusion.

---

## References

- CC BY-SA 4.0 deed: <https://creativecommons.org/licenses/by-sa/4.0/>
- EDRDG (JMdict/JMnedict): <https://www.edrdg.org/>
- jmdict-furigana by Doublevil: <https://github.com/Doublevil/JmdictFurigana>
- aonsoku `NOTICE` file: [`../NOTICE`](../NOTICE)
- aonsoku MIT license: [`../LICENSE.txt`](../LICENSE.txt)
