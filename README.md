# EngStickler

A Claude Code plugin for people who talk to their agent in their own language and keep their technical
documentation in English. EngStickler checks every English text the agent writes. The text must be correct
technical English, and it must say exactly what the user meant.

"Eng" stands for both English and engineering: the plugin covers technical writing only. EngStickler checks
specifications, design documents, guides, READMEs, agent instructions, code comments, commit messages, and
the texts of pull requests and issues.

## How it works

- **Readers.** Two reader agents read the English the way a careful native reader would. Each translates it
  into the user's language by meaning, without seeing what the writing agent intended. Each reports every
  phrase that reads two ways, and every phrase a native writer of technical English would not use. The fast
  reader runs on Sonnet; the thorough reader runs on Fable.
- **The meaning check.** The writing agent compares each translation with the meaning it intended, and
  rewrites the English where the two differ. The user is never asked to judge a translation.
- **When the checks run.**

  | Check | What reads | When |
  |---|---|---|
  | Instant | a script: known calques and over-long sentences | after every edit |
  | Fast | the fast reader | at the end of each response that wrote English, and before a commit |
  | Thorough | the fast reader and the thorough reader, in parallel | before a push, and after a change to the agent's instruction files |

- **Learning from errors.** Every confirmed error goes into an error log. At the start of each session, the
  writing agent is warned about the errors it has made most often.

The hooks never call a model themselves. A hook finds the English that changed and writes it to chunk files:
small files of changed passages for the readers. Then it stops the response, the commit or the push, and
tells the agent which readers to run. A change is detected whether it was made with an edit tool or by a
script, because each file is compared with the last version the readers read.

## Status

Stage 1: built for its author's own use, with Russian as the user's language. A setup interview that works
for any user's language, an assessment of existing texts, published term dictionaries, and the user's own
style rules come in stage 2.

## Install from a local folder

Add the folder as a marketplace and enable the plugin in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "engstickler-marketplace": { "source": { "source": "directory", "path": "D:/EngStickler" } }
  },
  "enabledPlugins": { "engstickler@engstickler-marketplace": true }
}
```

The configuration file is `~/.claude/engstickler/config.json`. Every key is optional. The defaults are in
`lib/config.mjs`.

## Commands

`node scripts/es.mjs <command>`:

- `checked <session>` marks the changed passages of a response as read;
- `checked-commit` marks a commit message as read;
- `checked-push` marks the current HEAD as checked for a push;
- `log` appends confirmed errors to the log;
- `warnings` prints the warnings given to the writing agent at the start of a session;
- `pending` lists what is unread;
- `bench-grade <report>…` grades readers' reports against the benchmark of 75 known errors.

## Tests

`npm test` runs the unit tests (`test/unit.test.mjs`) and the end-to-end tests (`test/e2e.test.mjs`). No
test calls a model.

## Licence

Apache 2.0. The script's writing rules, such as the limit on sentence length, take their approach from
ASD-STE100 Simplified Technical English. They copy none of the standard's text and claim no compliance with
it.
