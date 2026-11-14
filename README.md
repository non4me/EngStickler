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
  | Fast | the fast reader, in the background | at the end of each response in which the agent wrote English; a commit is held back until the fast reader has reported |
  | Thorough | the fast reader and the thorough reader, in parallel | before a push, and after a change to the writing agent's instruction files, such as `CLAUDE.md` |

- **Learning from errors.** Every error the writing agent confirms goes into an error log. At the start of each session, the
  writing agent is warned about the errors it has made most often.

EngStickler's hooks in Claude Code never call a model themselves. A hook finds the English text that changed
and writes it to chunk files, small files that contain the changed passages for the readers. The chunks of one
response form a batch.

At the end of a response, the hook tells the writing agent which readers to start. The agent starts them in the
background and ends the response without waiting, so the user does not wait for the readers. When they report,
the agent fixes what they found and marks the batch as read. A commit or a push is held back until every batch
of the session is marked as read.

The agent's last message of a response often asks the user a question, and should remain the last thing on the screen. So the
agent opens the batch itself, with the command `open`, before it writes that message, and starts the readers at that point.
At the end of the response the hook finds nothing left to read, and nothing appears after the message. A report
that a reader sends while the user has not yet answered is acted on after the user answers.

A sentence the agent fixed in response to the readers' findings is read once more. A further fix of that sentence is
recorded as read without another reading, so that fixes do not send the text to the readers again and again.

The hooks watch only what the writing agent touches: the files it edits, and the files changed by a
command it runs. The text that already exists in a project is recorded once, the first time a session starts
there. The text the readers have read is recorded too. Only passages that are not yet recorded go to the
readers. So when a script rewrites a whole file but changes one paragraph, only that paragraph goes to the
readers.

## Status

Stage 1: the plugin is built for its author's own use. The `languages/` folder contains a folder for each
of these languages: Russian, Czech, German, Spanish, French and Polish. Only the Russian calque list is
based on errors found in real use. The other lists contain errors commonly made by speakers of those
languages, and are not yet confirmed by errors found in real use.

Stage 2 will add a setup interview that configures the plugin for any language the user speaks, an
assessment of a project's existing documents, and support for published glossaries of technical terms
and for the user's own style rules.

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

The configuration file is `~/.claude/engstickler/config.json`. It must name the user's language by its
code, for example `{"language": "ru"}`. Until it does, EngStickler checks nothing. Every other key is
optional, and the defaults are in `lib/config.mjs`.

## Languages

Everything specific to one of the languages users speak is kept in that language's folder,
`languages/<code>/`, and nowhere else:

- `language.json` names the language;
- `calques.json` lists calques and false friends in English written by speakers of that language. Each
  entry gives the form to use instead, an example of the error, and a corrected sentence;
- `stopwords.txt` lists the language's most common function words, if the language is written in the Latin
  alphabet;
- `benchmark/` holds texts with known errors, and the answer key that the readers are measured against;
- `test/` holds what the tests expect of the language, such as sentences that must not be taken for
  English.

Files often contain text in both English and the user's language: for example, a quotation in the
user's language inside an English document. Only the English text goes to the readers. A language written in
another alphabet is distinguished from English by its letters. A language written in the Latin alphabet is
distinguished from English by its function words: a passage counts as English when it contains more
English function words than function words of the user's language.

The plugin's source code names no language. To add a language, add its folder. Even without a calque list
or a benchmark, English written by speakers of that language is still checked by the readers.

## Commands

`node scripts/es.mjs <command>`:

- `open <session>` opens a batch of the English text written so far in the current response, and names the readers to start;
- `checked <session> [batch]...` records that the readers have read the given batches, or every open batch of
  the session when no batch is given;
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
