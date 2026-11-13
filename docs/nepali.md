# Nepali working reference

Working notes for Nepali speech recognition, captions, translation, and the
Devanagari → Latin glossary. Keep this file in sync with
`backend/assets/nepali-english-terms.json` and the Nepali rules in
`backend/app/services/transcriber.py`.

Language code: `ne`. Script: Devanagari. Word order: subject–object–verb.

## 1. What "Nepali" covers here

- Standard Nepali (Eastern/Central, Kathmandu-based) is the variety used by the
  ASR models and by most media in the pipeline.
- Nepali is the official language of Nepal and is also spoken in India
  (Sikkim, Darjeeling, Assam), Bhutan, and the diaspora.
- Speech routinely mixes Nepali, English technical vocabulary, and Hindi film
  or music phrases. A transcript can contain all three in one sentence; language
  detection must therefore judge the sentence, not individual loanwords.
- Formal writing is Sanskritised; everyday speech uses more tadbhav words and
  English loans. Captions should follow the spoken register, not literary Nepali.

## 2. Devanagari essentials

Devanagari is an abugida: every consonant carries an inherent **अ** unless a
vowel sign (matra) or the virama (**्**) changes it.

### Vowels

| Independent | Matra | Sound | Example |
|---|---|---|---|
| अ | — | a | क = ka |
| आ | ा | ā | का = kā |
| इ | ि | i | कि = ki |
| ई | ी | ī | की = kī |
| उ | ु | u | कु = ku |
| ऊ | ू | ū | कू = kū |
| ऋ | ृ | ri | कृ = kri |
| ए | े | e | के = ke |
| ऐ | ै | ai | कै = kai |
| ओ | ो | o | को = ko |
| औ | ौ | au | कौ = kau |
| अं | ं | an/anusvara | कं = kan |
| अँ | ँ | ã/chandrabindu | कँ = kã |
| अः | ः | ah/visarga | कः = kah |

### Consonants

| Place | Stops | Nasal |
|---|---|---|
| Velar | क ख ग घ | ङ |
| Palatal | च छ ज झ | ञ |
| Retroflex | ट ठ ड ढ | ण |
| Dental | त थ द ध | न |
| Labial | प फ ब भ | म |

Semivowels and sibilants: य र ल व, श ष स ह. Common conjuncts: क्ष, त्र, ज्ञ, श्र.

### Nepali-specific reading notes

- **व** is pronounced /w/ or /b/ depending on the word; ASR often confuses ब/व.
- **श, ष, स** merge to /s/ in most speech; spelling still distinguishes them.
- **ज्ञ** is usually /gy/ (ग्य), **क्ष** is /chh/ or /ks/, **त्र** is /tr/.
- Final inherent **अ** is often dropped in speech but retained in writing.
- **ज़, फ़, क़, ग़** appear in loans; Nepali ASR may drop the nukta.

### Punctuation and Unicode hygiene

- **।** (danda, U+0964) is the Nepali full stop. **॥** (double danda) is
  literary/verse and rare in captions.
- Modern Nepali also uses `, ; : ? !` and quotation marks.
- Keep the danda attached to the preceding word. Whisper sometimes emits an
  ASCII `|` for `।`; map it.
- Normalise to NFC. Strip zero-width space, word joiner, and BOM
  (`U+200B`, `U+2060`, `U+FEFF`). Handle ZWNJ/ZWJ (`U+200C`, `U+200D`) carefully:
  they can be meaningful in Devanagari shaping, so do not strip them blindly.
- Do not rewrite names or places just to "fix" spelling. Use hotwords instead.

### Common ASR confusion sets

| Confusion | Example |
|---|---|
| स / श / ष | स्वागत → सवागत, श्वागत |
| ब / व | विशिष्ट → बिशिष्ट |
| ज / ज़ | विन्डोज / विन्डोज़ |
| ि / ी | भिडियो → भेडियो, भिडीयो |
| ु / ू | गुरु → गुरू |
| े / ै | सेटिङ → सैटिङ |
| ो / ौ | को → कौ |
| ं / ँ | तपाईं / तपाईँ |
| ड / ड़, ढ / ढ़ | पढ्नु / पढ़्नु |
| त / ट, द / ड | दिन / डिन |

Spelling variants are normal, not errors: काठमाडौं / काठमाडौँ, मङ्गलबार /
मंगलबार, बैशाख / वैशाख. Pick one project standard per name and keep it stable.

## 3. Grammar in working order

### Pronouns

| Person | Nepali | Notes |
|---|---|---|
| I | म | |
| we | हामी | |
| you (lowest) | तँ | intimate/insulting; avoid in captions |
| you (informal) | तिमी | friends, peers |
| you (formal) | तपाईं | default polite form |
| he/she (low) | ऊ | |
| he/she (mid) | उनी | respectful, gender-neutral in writing |
| he/she (high) | उहाँ | respectful; takes honorific verbs |
| this / that | यो / त्यो | |
| these / those | यी / ती | |

### Noun phrase

- Plural: **-हरू** (optional when number is clear): किताब → किताबहरू.
- Genitive agrees with the possessed noun: **को** (masc. sg.), **की** (fem.),
  **का** (masc. pl./honorific): रामको किताब, सीताकी आमा, उनीहरूका घर.
- Adjectives usually precede and do not change, but some agree: सानो केटा,
  सानी केटी, साना किताबहरू.
- Classifiers: **वटा** (things), **जना** (people), **पटक** (times), **वर्ष**
  (years), **दिन** (days), **घण्टा** (hours), **मिनेट** (minutes).

### Postpositions

| Nepali | Meaning | Example |
|---|---|---|
| को / की / का | of | रामको घर — Ram's house |
| लाई | to, for; definite object | मलाई दिनुहोस् — give it to me |
| ले | by, with (ergative/instrumental) | मैले गरें — I did it |
| मा | in, at, on | काठमाडौंमा — in Kathmandu |
| बाट | from, by | घरबाट — from home |
| देखि | from, since | बिहानदेखि — since morning |
| सँग | with | साथीसँग — with a friend |
| सम्म | up to, until | भोलिसम्म — until tomorrow |
| लागि | for | तिम्रो लागि — for you |
| भन्दा | than, from | मभन्दा अग्लो — taller than me |
| माथि / तल | above / below | टेबलमाथि — on the table |
| भित्र / बाहिर | inside / outside | घरभित्र — inside the house |
| अगाडि / पछाडि | in front / behind | मेरो अगाडि — in front of me |
| तिर | towards | घरतिर — towards home |
| बिना | without | पानीबिना — without water |

### The copula: हो vs छ

- **हो** identifies/defines: यो किताब हो — This is a book.
- **छ** describes or locates: ऊ ठीक छ — He is fine; किताब टेबलमा छ — The book is on the table.

Present:

| Person | हो (defining) | छ (descriptive) |
|---|---|---|
| म | हुँ | छु |
| हामी | हौं | छौं |
| तँ | होस् | छस् |
| तिमी | हौ | छौ |
| तपाईं / उहाँ | हुनुहुन्छ | हुनुहुन्छ |
| ऊ | हो | छ |
| उनी (masc./pl.) | हुन् | छन् |
| उनी (fem.) | हुन् | छिन् |

Past:

| Person | थियो-type | भयो-type |
|---|---|---|
| म | थिएँ | भएँ |
| हामी | थियौं | भयौं |
| तँ | थिइस् | भइस् |
| तिमी | थियौ | भयौ |
| तपाईं / उहाँ | हुनुहुन्थ्यो | हुनुभयो |
| ऊ | थियो | भयो |
| उनी (masc./pl.) | थिए | भए |
| उनी (fem.) | थिइन् | भइन् |

### Verb essentials

Infinitive ends in **-नु**: गर्नु (do), जानु (go), आउनु (come), खानु (eat),
पिउनु (drink), बोल्नु (speak), भन्नु (say), देख्नु (see), सुन्नु (hear),
बुझ्नु (understand), सिक्नु (learn), पढ्नु (read/study), लेख्नु (write),
बस्नु (sit/stay), उठ्नु (get up), सुत्नु (sleep), किन्नु (buy), बेच्नु (sell),
दिनु (give), लिनु (take).

Simple past of **गर्नु** (transitive subjects take ले):

| Person | Form | Example |
|---|---|---|
| मैले | गरें | I did |
| हामीले | गर्यौं | we did |
| तँले | गरिस् | you did (low) |
| तिमीले | गर्यौ | you did |
| तपाईंले | गर्नुभयो | you did (high) |
| उसले | गर्यो | he/she did |
| उनीहरूले | गरे | they did |
| उहाँले | गर्नुभयो | he/she did (high) |

Simple past of **जानु** (intransitive, no ले):

| Person | Form |
|---|---|
| म | गएँ |
| हामी | गयौं |
| तँ | गइस् |
| तिमी | गयौ |
| तपाईं | जानुभयो |
| ऊ | गयो |
| उनी (masc./pl.) | गए |
| उनी (fem.) | गइन् |
| उहाँ | जानुभयो |

Core patterns:

- Habitual/future: **-छु / -छौं / -छ / -छन्** — म जान्छु, ऊ गर्छ.
- Continuous: **गर्दै छु** or **गरिरहेको छु** — I am doing.
- Perfect: **गरेको छु** — I have done; **गएको छ** — he has gone.
- Future: **गर्नेछु**, **जानेछ**, **हुनेछ** — I will do, he will go, it will be.
- Necessity: **गर्नुपर्छ** — must do; **जानुपर्छ** — must go.
- Ability: **गर्न सक्छु** — I can do; **जान सक्छ** — he can go.
- Negation: **गर्दिनँ** (I don't do), **गइनँ** (I didn't go), **छैन** (isn't),
  **हुँदैन** (doesn't happen), **थिएन** (wasn't), **नगर्नुहोस्** (please don't).
- Imperative: **गर** (low), **गर्नु** (polite), **गर्नुहोस्** (high).

### Questions

- Yes/no questions use rising intonation and often **हो?** / **होइन?**:
  तिमी आउँछौ? — Are you coming?
- Wh-words stay in place: तिमी कहाँ जान्छौ? — Where are you going?
- के (what), को (who), कहाँ (where), कहिले (when), किन (why), कसरी (how),
  कति (how much/many), कुन (which), कस्तो (what kind).

### Conjunctions and connectors

र (and), तर (but), वा (or), किनभने (because), त्यसैले (therefore),
यदि … भने (if), जब … तब (when … then), पछि (after), अघि (before),
साथै (also), अनि (and then).

### Honorifics and address

- Use **तपाईं** with strangers, elders, and in formal captions; **तिमी** with
  peers; **तँ** only for very close/intimate or abusive speech.
- High-honorific verbs: **हुनुहुन्छ**, **गर्नुहुन्छ**, **जानुहुन्छ**,
  **भन्नुहुन्छ**, **खानुहुन्छ**.
- **हजुर** is very high respect; **हजुरबुबा / हजुरआमा** are grandparents.
- Address terms: बुबा (father), आमा (mother), दाजु/दाई (elder brother),
  भाई (younger brother), दिदी (elder sister), बहिनी (younger sister),
  सर/म्याडम (teacher/sir/ma'am), जी (respectful suffix: शाहिल जी).

### Discourse particles

These carry tone and are usually not translated word-for-word:

| Particle | Effect | Example |
|---|---|---|
| नि | emphasis, "of course" | हो नि — Yeah, exactly. |
| त | contrast/emphasis, "but/you know" | म त जान्छु नि — I'm going, you know. |
| हैन | tag question, "right?" | तिमी आउँछौ हैन? — You're coming, right? |
| ल | okay, come on, there you go | ल, जाऊ — Okay, go. |
| अनि | and then | अनि के भयो? — And then what happened? |
| अब | now, well | अब के गर्ने? — So what do we do now? |
| क्यारे | hearsay, "apparently" | ऊ आउँछ क्यारे — Apparently he's coming. |
| होला | probability, "maybe" | होला — Maybe. |
| क्या | emphasis/what | क्या राम्रो! — How nice! |

### Numbers

| | | | |
|---|---|---|---|
| ० शून्य | १ एक | २ दुई | ३ तीन |
| ४ चार | ५ पाँच | ६ छ | ७ सात |
| ८ आठ | ९ नौ | १० दश | ११ एघार |
| १२ बाह्र | १३ तेह्र | १४ चौध | १५ पन्ध्र |
| १६ सोह्र | १७ सत्र | १८ अठार | १९ उन्नाइस |
| २० बीस | २१ एक्काइस | २२ बाइस | २३ तेइस |
| २४ चौबीस | २५ पच्चीस | २६ छब्बीस | २७ सत्ताइस |
| २८ अठ्ठाइस | २९ उनन्तीस | ३० तीस | ४० चालीस |
| ५० पचास | ६० साठी | ७० सत्तरी | ८० असी |
| ९० नब्बे | १०० सय | १,००० हजार | १,००,००० लाख |
| १,००,००,००० करोड | | | |

Ordinals: पहिलो, दोस्रो, तेस्रो, चौथो, पाँचौं, छैटौं, सातौं, आठौं, नवौं, दसौं.

### Time and dates

- अहिले (now), आज (today), हिजो (yesterday), भोलि (tomorrow), अस्ति (day
  before yesterday), पर्सि (day after tomorrow).
- बिहान (morning), दिउँसो (afternoon), साँझ/बेलुका (evening), रात (night).
- Days: आइतबार, सोमबार, मङ्गलबार, बुधबार, बिहीबार, शुक्रबार, शनिबार.
- Bikram Sambat months: बैशाख, जेठ, असार, साउन, भदौ, असोज, कात्तिक, मंसिर,
  पुष, माघ, फाल्गुन, चैत. BS is roughly 56–57 years ahead of AD; do not convert
  a spoken date silently unless the caption explicitly needs an AD equivalent.

### Money

- रुपैयाँ (rupee), पैसा (paisa); written रु. In English captions use
  `Rs 500` or `NPR 500`, consistently.
- लाख = 100,000; करोड = 10,000,000. For English viewers, `15 lakh` may be
  clearer as `1.5 million`; choose one convention and keep it.

## 4. Nepali vs Hindi

Whisper's language ID often confuses Nepali and Hindi, and the Nepali fine-tune
can produce Hindi verb forms when the audio is unclear. These are the reliable
grammatical discriminators.

| Hindi | Nepali | English |
|---|---|---|
| है | छ / हो | is |
| हैं | छन् / हुन् | are |
| हूँ / हूं | छु / हुँ | I am |
| हुआ | भयो | became/happened |
| हुई | भई | became (fem.) |
| हुए | भए | became (pl.) |
| रहा | रहेको / रह्यो | staying/continuous |
| करना | गर्नु | to do |
| करता / करती / करते | गर्छ / गर्छिन् / गर्छन् | does |
| किया | गर्यो | did |
| दिया | दियो | gave |
| लिया | लियो | took |
| गया | गयो | went |
| गयी | गई / गइन् | went (fem.) |
| होगा / होगी | हुनेछ | will be |
| था / थी / थे | थियो / थिइन् / थिए | was/were |
| बहुत | धेरै | very/much |
| लेकिन | तर | but |
| अभी | अहिले | now |
| सबने | सबैले | everyone (erg.) |
| होता / होती / होते | हुन्छ / हुन्थ्यो | happens/used to happen |
| कितना | कति | how much |

### Shared forms: do not flag these as Hindi-only

Several Hindi and Nepali forms are identical or nearly identical. They are valid
Nepali and must not trigger a language warning on their own:

- **गए** — Nepali 3rd-person plural/honorific simple past of जानु:
  उनीहरू घर गए — They went home.
- **गई** — Nepali 3rd-person feminine simple past: ऊ गई — She went.
- **रहे** — Nepali 3rd-person plural past of रहनु: उनीहरू त्यहाँ रहे —
  They stayed there. (बसे is more common in speech.)
- **रही** — feminine counterpart: ऊ रही — She stayed.
- **दिए / लिए** — Nepali 3rd-person plural/honorific past of दिनु/लिनु:
  उहाँले दिए — He/she gave.
- **लेकिन** and **बहुत** are understood and used in Nepali, though तर and धेरै
  are the standard/native choices. Treat them as weak evidence, not proof.

Current `_HINDI_MARKERS` includes गए, रहे, रही, बहुत, and लेकिन. Because the
warning fires at **3+ hits and ≥2% token density**, a legitimate Nepali
transcript can cross the threshold on shared forms alone. Recommended fix:
remove गए, रहे, रही, बहुत, and लेकिन from the marker set, or assign them a lower
weight than है/हैं/था/थी/थे/हुआ/हुई/हुए/किया/गया/गयी/होगा/सबने/अभी/कितना.
Keep the density check; code-mixed Nepali can contain a few genuine Hindi words.

### Parallel examples

| Hindi | Nepali | English |
|---|---|---|
| यह किताब है। | यो किताब हो। | This is a book. |
| वह बहुत अच्छा हुआ। | त्यो धेरै राम्रो भयो। | That turned out very good. |
| मैंने काम किया। | मैले काम गरें। | I did the work. |
| वे घर गए। | उनीहरू घर गए। | They went home. |
| मैं ठीक हूँ। | म ठीक छु। | I am fine. |
| तुम कहाँ जा रहे हो? | तिमी कहाँ जाँदै छौ? | Where are you going? |
| मुझे पानी चाहिए। | मलाई पानी चाहिन्छ। | I need water. |
| क्या तुम आओगे? | तिमी आउँछौ? | Will you come? |
| वह था। | ऊ थियो। | He was. |

## 5. Nepali → English caption translation

- Translate line by line and preserve timings. Never merge or reorder lines.
- Prefer natural spoken English over literal syntax. Nepali is verb-final;
  English is not.
- Keep names, places, brands, and numbers as spoken. Transliterate personal
  names consistently (one spelling per person).
- Honorifics usually flatten: तपाईं/उहाँ → you/he/she; add "sir/madam" only
  when the speaker uses it as an address. Kinship address (दाई, दिदी) may become
  "brother/sister" only when it is being used as a form of address, not when it
  is literal.
- Discourse particles (नि, त, हैन, ल, अनि, क्यारे, होला) usually disappear.
  Translate the intent: "right?", "well", "apparently", "maybe".
- Nepali simple past often maps to English present perfect or past depending on
  context: "मैले गरेको छु" → "I have done"; "मैले गरें" → "I did".
- Idioms: translate meaning, not words.
  - नाक काट्नु — to lose face
  - आँखा पर्नु — to catch sight of
  - मन पराउनु — to like
  - खुट्टा तान्नु — to hinder/pull someone back
  - हात हाल्नु — to meddle
  - बाटो हेर्नु — to wait for someone
- Numbers: lakh/crore may confuse English viewers. `१५ लाख` → `1.5 million`
  when precision matters; otherwise keep `15 lakh` and let context carry it.
- Currency: `रु. ५००` → `Rs 500` / `NPR 500`.
- Cultural terms: दशैं, तिहार, छठ, होली, ल्होसार, बुद्ध जयन्ती, गाईजात्रा,
  इन्द्रजात्रा; मम, दाल भात, सेल रोटी, ढिँडो, गुन्द्रुक, छुर्पी. Keep the
  Nepali name; gloss only if the line has room and the meaning depends on it.
- English code-mixing: keep English words in English; do not translate them
  into Devanagari or vice versa.

## 6. Code-mixing glossary: review notes

`backend/assets/nepali-english-terms.json` maps Devanagari spellings of English
loans back to Latin script so captions keep English words in English. The
current matcher does a direct lookup, then strips one case suffix from
`_NEPALI_CASE_SUFFIXES`.

### What works

- Direct matches: भिडियो → video, युट्युब → YouTube, विन्डोज → Windows.
- Suffix stripping keeps Nepali grammar visible: युट्युबमा → YouTubeमा,
  भिडियोको → videoको, कम्पनीहरू → companyहरू.
- Mixed-script tokens (Latin stem + Devanagari suffix) are intentional and
  readable in Nepali digital writing.

### Coverage gaps worth closing

Common ASR spelling variants that are not yet keys:

- एडिटिङ (alongside इडिटिङ), एडिट, इडिट
- डाटा, डाटाबेस (alongside डेटा, डेटाबेस)
- फीचर (alongside फिचर)
- भर्जन / भर्शन (alongside भर्सन)
- यूट्युब / यूट्यूब / युट्यूब (alongside युटुब, युट्युब)
- यूज / यूजर (alongside युज, युजर)
- मीटर (alongside मिटर), मिनट (alongside मिनेट), लीटर (alongside लिटर)
- लाइनक्स (alongside लिनक्स)
- सेयर (alongside शेयर)
- टीबी (alongside टिबि), सीपीयू / सिपियू (alongside सिपियु, सीपीयू)
- नार्मल (alongside नर्मल), सेकण्ड (alongside सेकेन्ड)
- अपलोड / अप्लोड, अफलाईन, अनलाईन, ईमेल — pick the spellings the ASR actually
  emits and add only those.

Case-suffix gaps:

- Plural written with short ु: हरुले, हरुको, हरुमा, हरुबाट, हरुसँग, हरुलाई,
  हरुका, हरुकी — ASR often writes हरु instead of हरू.
- Anusvara variant: संग (alongside सँग); सँगै / संगै.
- Emphatic suffixes: कै, मै, बाटै, सम्मै.
- Other postpositions: तिर, बिना/विना, द्वारा, जस्ता/जस्ती, देखी (misspelling
  of देखि).
- Genitive plurals: हरूका, हरूकी, हरूकै.

### Risks and edge cases

- **Name collisions.** टिम → "team" will also rewrite the name Tim; सरी →
  "sorry" can collide with a name or "sari"; एप्पल → "Apple" can be a name.
  Give user hotwords/names precedence over the glossary, or leave ambiguous keys
  out.
- **Context-dependent English.** सेटिङ can be "setting" or "settings"; किलो can
  be "kg" or "kilo"; भ्यु can be "view" or "views"; हेडफोन is usually
  "headphones". Pick a caption convention and document it.
- **Multiword terms.** हार्ड डिस्क (two tokens), च्याट जीपीटी, वाई-फाई and
  वाईफाई are not handled by a single-token lookup. Add phrase-level corrections
  or a pre-token normalizer if these matter.
- **Suffix stripping is greedy.** A glossary word that legitimately ends in a
  suffix-like string must be a direct key (direct lookup runs first). Audit new
  entries for this.
- **Mixed-script rendering.** Ensure the selected Devanagari font also covers
  Latin (the bundled Mukta, Noto Sans Devanagari, Hind, Kalam, Rajdhani, Tiro,
  and Yatra One all declare `latin`), otherwise a Latin stem in a Devanagari
  caption can fall back to a different face.
- **Spelling consistency.** Use तपाईं (anusvara) consistently; the current
  `_NEPALI_WORD_CORRECTIONS` maps तव्य → तपाईँ (chandrabindu), while the UI and
  README use तपाईं. Both are valid, but pick one.

## 7. Test phrases

Use these as ASR/translation smoke tests.

| Nepali | English |
|---|---|
| नमस्ते, मेरो नाम शाहिल हो। | Hello, my name is Shahil. |
| तपाईंलाई कस्तो छ? | How are you? (formal) |
| म ठीक छु, धन्यवाद। | I'm fine, thank you. |
| आज हामी काठमाडौंमा भेट्यौं। | We met in Kathmandu today. |
| उहाँले भन्नुभयो, “यो राम्रो छ।” | He/she said, "This is good." |
| मैले काम गरें। | I did the work. |
| उनीहरू घर गए। | They went home. |
| हिजो पानी पर्यो। | It rained yesterday. |
| भोलि बिहान बैठक हुनेछ। | There will be a meeting tomorrow morning. |
| मलाई नेपाली सिक्न मन लाग्छ। | I want to learn Nepali. |
| उसले सोध्यो, “तिमी कहाँ जान्छौ?” | He asked, "Where are you going?" |
| यो भिडियो धेरै राम्रो छ; सबैले हेर्नुपर्छ। | This video is really good; everyone should watch it. |
| कृपया माइक्रोफोन अलि नजिक राख्नुहोस्। | Please keep the microphone a little closer. |
| हामीले आजै काम सक्नुपर्छ। | We have to finish the work today itself. |
| उहाँहरू त्यहाँ रहे। | They stayed there. |
| यो ल्यापटपको ब्याट्री राम्रो छ, तर विन्डोज अपडेट ढिलो हुन्छ। | This laptop's battery is good, but Windows updates are slow. |
| मिटिङ साढे तीन बजे सुरु हुनेछ। | The meeting will start at 3:30. |
| उहाँले दशैंमा घर जानुभयो। | He/she went home for Dashain. |
| यो काम सजिलो छैन, तर गर्न सकिन्छ। | This work isn't easy, but it can be done. |
| मलाई थाहा छैन, उहाँ आउनुहुन्छ कि हुँदैन। | I don't know whether he/she is coming. |

## 8. Where this plugs into CutClipper

- Language codes and detection: `backend/app/api/routes.py` (`ne`, `hi`, `en`).
- Nepali models, prompt, chunking, warnings, punctuation and spelling rules:
  `backend/app/services/transcriber.py`.
- Devanagari → Latin glossary: `backend/assets/nepali-english-terms.json` and
  `_english_term_for` in the transcriber.
- Nepali → English translation prompt: `backend/app/services/translator.py`.
- Dual-track burned captions and danda/spacing cleanup:
  `backend/app/pipeline/captions.py`.
- Devanagari caption fonts: `frontend/src/lib/captionFonts.json`
  (Mukta, Noto Sans Devanagari, Hind, Kalam, Rajdhani, Tiro Devanagari Hindi,
  Yatra One, Teko, Baloo 2).
- Hotwords: `CUTCLIPPER_NEPALI_HOTWORDS` — names/places, not common words.

## 9. Maintenance checklist

When adding a Nepali correction or glossary entry:

1. Confirm the source spelling is a real ASR output, not a guess.
2. Check for name collisions and context-dependent meanings.
3. Add the common spelling variants.
4. Check whether a case suffix can attach; add suffix variants if needed.
5. Add a test in `backend/tests/test_transcriber_runtime.py`.
6. Keep word timings and token boundaries intact; never rewrite a word into
   multiple tokens unless the timing model can handle it.
7. Prefer hotwords for names and places; keep corrections for non-words.
