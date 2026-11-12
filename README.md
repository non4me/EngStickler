# EngStickler

A Claude Code plugin for people who talk to their agent in their own language and keep their technical
documentation in English. EngStickler checks everything the agent writes in English. The text must be correct
technical English, and it must say exactly what the user meant.

"Eng" stands for both English and engineering: the plugin covers technical writing only. EngStickler checks
specifications, design documents, guides, READMEs, agent instructions, code comments, commit messages, and
the text of pull requests and issues.

## How it works

- **Readers.** Two reader agents read the English the way a careful native reader would. Each translates it
  into the user's language for meaning, not word for word, without seeing what the writing agent
  intended. Each reports every phrase that can be read two ways, and every phrase a native writer of technical English would not use. The fast
  reader runs on Sonnet; the thorough reader runs on Fable.
- **The meaning check.** The writing agent compares each translation with the meaning it intended, and
  rewrites the English where the two differ. The user is never asked to judge a translation.
- **When the checks run.**

  | Check | Checked by | When |
  |---|---|---|
  | Instant | a script: known calques and over-long sentences | after every edit |
  | Fast | the fast reader | at the end of each response in which the agent wrote English, and before a commit |
  | Thorough | the fast reader and the thorough reader, in parallel | before a push, and after a change to the writing agent's instruction files, such as `CLAUDE.md` |

- **Learning from errors.** Every error the writing agent confirms goes into an error log. At the start of each session, the
  writing agent is warned about the errors it has made most often.

EngStickler's hooks in Claude Code never call a model themselves. A hook finds the English that changed and
writes it to chunk files: small files of changed passages for the readers. Then it holds back the response,
the commit or the push until the readers have run, and tells the writing agent which readers to run. A change is detected whether it was made with an edit tool or by a
script, because each file is compared with the last version the readers read.

## Status

Stage 1: built for its author's own use, with Russian as the user's language. Stage 2 will add a setup interview
that works for any language a user speaks, an assessment of a project's existing documents, support for
published glossaries of technical terms, and the user's own style rules.

## Install

In Claude Code:

```
/plugin marketplace add non4me/EngStickler
/plugin install engstickler@engstickler-marketplace
```

To run the plugin from a local clone instead, add the clone's folder as a marketplace and enable the
plugin in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "engstickler-marketplace": { "source": { "source": "directory", "path": "/path/to/EngStickler" } }
  },
  "enabledPlugins": { "engstickler@engstickler-marketplace": true }
}
```

The plugin needs Node.js 22 or later and git.

The configuration file is `~/.claude/engstickler/config.json`. Every key is optional. The defaults are in
`lib/config.mjs`.

## Commands

`node scripts/es.mjs <command>`:

- `checked <session>` records that the readers have read the changed passages of a response;
- `checked-commit <session>` records that a commit message has been read;
- `checked-push <session>` records that the commits of a push have had the thorough check;
- `log` appends confirmed errors, read from standard input, to the error log;
- `warnings` prints the warnings given to the writing agent at the start of a session;
- `pending` lists what the readers have not read yet;
- `bench-grade <report>…` grades readers' reports against a benchmark of 75 known errors.

## Tests

`npm test` runs the unit tests (`test/unit.test.mjs`) and the end-to-end tests (`test/e2e.test.mjs`). No
test calls a model.

## License

Apache 2.0. The instant check's writing rules, such as the limit on sentence length, follow the approach of
ASD-STE100 Simplified Technical English. They copy none of the standard's text and claim no compliance with
it.
