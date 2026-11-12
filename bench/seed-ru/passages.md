### Node 1.6.1 · title
What the checks hold, and when they run

### Node 1.6.1 · text
Two things are checked mechanically:
- that the specification conforms to those rules of the guidelines the table of checks lists;
- that the specification and the code still agree with each other.

Every check is deterministic but the review of the code.

At every commit that changes code, an independent reviewer judges whether the code does what the nodes it names say, and nothing they do not (§s-nyh9yk22ba6g77q).

The checks run when a commit is made. Where an agent writes the specification, the tests or the code, they also run after each of its edits (§s-epaw9sgyaajzn8g). Some of its edits are refused before they are made (§s-83ev4wwesbwnhnp). The tests of the system's code run at a push if the specification has the status `approved`.

A failed check refuses the change, unless the table of checks says otherwise (§s-jau82aq9juv9zzh).

### Node 1.6.1 · reason
Every check but the review is binary, so refusing costs nobody a judgement. A check that sometimes refuses for a reason nobody can reproduce is bypassed at the first chance and never trusted again. The review is the one judgement, because whether code does only what its rules say cannot be decided by a script.

Run at each of an agent's edits, a check finds a mistake where it is made. The order of test and code can be seen only at the edits, since a commit holds the test and the code together.

The tests run at a push rather than at a commit, since a suite takes longer than a commit should wait and a commit not yet pushed misleads nobody. No test runs at a push while the specification is a draft, for the reason §s-xhcmchcngykvn2k gives.

---

### Node 3.1 · title
What the sections share is agreed in contracts

### Node 3.1 · text
Contracts agrees what the sections of the specification share:

- the terminology;
- the rules that bind more than one top-level section.

What only one section needs, that section holds itself, except a term (§s-ypa92gpcj3f5zj8).

Contracts exists where the rules of the specification share something, such as a term. It stands as a section of its own within the base specification. A specification with no term and nothing else shared needs none.

### Node 3.1 · reason
Sections that coin their own words, or their own rules for one matter, stop understanding one another.

Holding in contracts only what binds more than one section keeps contracts from answering for what a single section defines.

Contracts exists only to agree what the parts of a specification share, so a specification with nothing shared has nothing to put in it. It stands apart since it belongs to none of the others.

---

### Node 7.13 · title
=6.11

### Node 7.13 · text
A node is written in the ordinary case of its language. A name quoted from the code keeps its spelling.

Outside such a name, capitals may stand on one word or on two running (REST API). A phrase or a sentence, three words or more running, is never set in capitals. What must stand out is said in the words.

### Node 7.13 · reason
Set in capitals, a phrase reads as more binding than the words around it, although every word of a rule binds alike. A reader who meets capitals on every line starts reading the capitals instead of the sentence.

A word or two in capitals are most often an abbreviation or a name keeping its own spelling, which no check tells from a word stressed. So they are left alone. Three words running are seldom anything but stress. A run of abbreviations as long is rare enough to be worded around.

---

### Node 1.3.2 · title
What a draft means

### Node 1.3.2 · text
The specification, a section or a rule that is not approved at present is a draft:

- While the specification as a whole is a draft, an approved rule need not have code yet, and a push runs no test (§s-xhcmchcngykvn2k). The specification must still conform to the guidelines. So must whatever a commit adds or changes, from the start: code must have its tests and name its rules. Only code and tests a commit leaves alone may name no rule (§s-kkbqcb9xrpaepwn).
- For a section, the status indicates the combined state of the whole group of rules inside it. If at least one rule is a draft, the whole group has that status.
- A draft rule is not implemented: no code or test is written or changed for it.
- If a rule's title, text or reason changes, the rule is automatically set to `draft`.

### Node 1.3.2 · reason
While the specification is a draft, the work is above all on the specification, the code and the tests secondary in it.

While the specification or a rule has not yet been approved, it may be incomplete or wrong, so implementing it would fix its incompleteness in the code, or the code would be built on guesses.

An existing project migrating to this method also holds code and tests written earlier, which must be brought to the form the method describes. That is possible only in `draft` mode. Only what a commit leaves alone is relieved, so that what is new conforms from the start.

The status of a section shows at a glance which parts of the specification are in progress and need the rules inside them approved.

A status of their own for sections and nodes lets an already broadly approved specification be developed and refined without withdrawing its status.

---

### Node 6.1 · title
What a link is

### Node 6.1 · text
A link is a directed relation from one node to another. Every link names what it means by a type. The types of link are:
- `implements` — the linking node is how the linked one is carried out.
- `refines` — the linking node states the linked node more precisely, or for a narrower case.
- `constrains` — the linking node holds a condition the linked rule depends on.
- `supersedes` — the linking node replaces the linked node, which is archived.
- `exempts` — the linking node exempts the linked rule, or every rule under the linked section, from being implemented (§s-gf6n8ge4mke3pr2).
- `overrides` — the linking node, of an extension, changes the linked main rule in a project using that extension (§s-e6stjaxkn44ys4m).
- `cites` — the linking node cites the linked one (§s-cxtt6jvhqcey2k9), and no other type says how the two bear on each other. So it holds no link of another type to it.
- `term-relation` — the linking term and the linked term are bound, for as long as both exist, in the ratio the link carries.
- `uses` — what the linking term names makes use of what the linked term names while taking part in a process. For example, a user fills in a form while signing up. The link carries no ratio. A term that only starts a process, as an operator starting an export, uses nothing the process uses.

An extension of the guidelines may define further types of link.

### Node 6.1 · reason
A link without a type records only that somebody thought of two nodes together. No check can grade it. No diagram can draw it. A type named without its meaning is the same guess one step later.

---

### Node 4.2 · title
How the technical appendix relates to the base specification

### Node 4.2 · text
The technical appendix is inseparable from the base specification.

The technical appendix never contradicts a rule of the base specification but extends and refines it. A rule too narrow for an implementation is widened in the base, and its detail goes to the technical appendix.

A node of the appendix describes how the nodes of the base specification it implements are to be carried out. It does so in enough detail to be read only one way: exact values, examples and the edge cases of that implementation. It never restates what they state.

Each node of the appendix implements at least one node of the base specification, except:

- a section, which requires nothing (§s-7445ahgjck2aefg);
- a choice covering the whole system, which stands in the section of the stack;
- the technical debt (§s-2r7k2aeyusgy6fw).

### Node 4.2 · reason
A part allowed to contradict the base would leave the base binding nowhere, since no rule could be relied on without reading the implementation too.

Described less exactly, a node would leave a choice to whoever implements it (§s-tj38pvm38nepaf5). Read beside the nodes it implements, an appendix node restating them would be a second copy, and a copy drifts from what it copies.

A node bound to the rule it implements is found when that rule changes and is read beside it.

---

### Node 9.1 · title
What is considered the system's code

### Node 9.1 · text
The system's code is the code implementing the specification outside its guidelines, and the tests verifying that code. The implementing code includes code written by hand and code generated from the specification's nodes.

The repository's configuration, its own tools and the tests of those tools are not the system's code. A project's own checks and generators are among those tools (§s-2fau85dfyyeq66m, §s-km4x4s26kv7pjze). Whether a file is the system's code is decided by where it lives.

### Node 9.1 · reason
The rules binding code to the specification need a line between the system's code and what serves the work on the system. A rule is considered implemented only by its code and a passing test together (§s-6fw72j65jkqrfpf), so the tests are on the side of the code. Where a file lives is the same to every check, so it draws that line.

---

### Node 1.2.6 · title
The one source of truth is the specification, not the code

### Node 1.2.6 · text
The one source of truth about the system is the specification, not the code. Everything the system is made of is defined in the specification: its logic and its structures, such as a set of states, a list of members or a table of routes. The code implements it and holds nothing of its own.

The code is checked against the specification. A rule that leaves its content to the code is a defect. It is repaired when the rule is revised.

### Node 1.2.6 · reason
Two sources of truth sooner or later disagree, and then nobody knows which of them holds. The code cannot be the source, since code cannot be checked against itself.

Held in the specification and checked against the code, the content is in one place, and the disagreement is found by a machine.

---

### Node 7.7 · title
A node holds what is applied together, and nothing applied apart

### Node 7.7 · text
Requirements that a reader needs together, to carry out any one of them rightly, stand in one node. A requirement carried out rightly without the other requirements of its node stands in a node of its own. A main thought and its qualifications (§s-juucyammgq4shq8) are considered one requirement.

### Node 7.7 · reason
A rule is applied from the node it is read in. A requirement it needs that stands in another node is missed by whoever reads the rule alone. A requirement assembled from several nodes is harder to carry out than one stated whole in one node. A main thought read without its qualifications is carried out where they narrow it.

A node is approved, cited and bound to code as a whole. A SpecTag naming a node that holds requirements carried out apart does not say which of them the code carries out.

---

### Node 7.9 · title
Naming rules

### Node 7.9 · text
A name the specification defines — a term, a field used apart from its object — is never a general word alone, such as type, action or item. It includes what the general word applies to: userAction, not action.

A property of an object that has a name of its own is written as that name, a dot and the property's key, in code font: `TextRule.list`, `meta.comments`. Written so, the key may be a general word.

A property of an object with no name of its own is written with that object named in the same phrase: a node's `kind`, a link's `type`.

### Node 7.9 · reason
A defined name is read in every rule that uses it, far from its definition. A general one there means whatever each rule's context suggests: a field called type held a sort of request in one log, a user's action in another and a sort of error in a third.

Written with its object, a key is unique: the reader sees which object it belongs to. Code font tells it from an ordinary word.
