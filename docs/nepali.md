# Nepali working reference

Working notes for Nepali speech recognition, captions, translation, the
Devanagari → English glossary, and Devanagari → Roman Nepali transliteration.
Keep this file in sync with `backend/assets/nepali-english-terms.json`,
`backend/assets/nepali-roman-lexicon.json`, and the Nepali rules in
`backend/app/services/transcriber.py`.

Language code: `ne`. Script: Devanagari, with optional Roman Nepali captions.
Word order: subject–object–verb.

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

Language detection is limited to Nepali and English. A Hindi-like detection is
folded into Nepali, so the fine-tuned model is used and the UI never offers
Hindi or warns about it. These discriminators therefore serve manual review of
unclear audio, not an automatic warning. गए, रहे, रही, दिए, लिए, बहुत, and
लेकिन remain valid or common Nepali and must not be treated as Hindi-only.

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
`NEPALI_CASE_SUFFIXES` in `backend/app/services/nepali_terms.py`.

### What works

- Direct matches: भिडियो → video, युट्युब → YouTube, विन्डोज → Windows.
- Suffix stripping keeps Nepali grammar visible: युट्युबमा → YouTubeमा,
  भिडियोको → videoको, कम्पनीहरू → companyहरू.
- Mixed-script tokens (Latin stem + Devanagari suffix) are intentional and
  readable in Nepali digital writing.
- Split English names are merged back into one caption word. The fine-tune
  writes `ChatGPT` variously as चार GPT, च्याट जिपिटी, chat GPT, and च्याडजिपीटी;
  `OpenAI` appears as Open AI, ओपन AI, and Open AIले.
  `merge_english_phrase` combines the adjacent words and keeps the first word's
  start and the second word's end, so karaoke timing still matches the audio.
  The shared phrase pass applies the same rule to edited text in the caption
  editor.
- Context-only fixes stay in `CONTEXT_WORD_CORRECTIONS` so valid words are not
  rewritten everywhere: `अहिलेको लागि भनेछ` → `अहिलेको लागि भने`,
  `गर्न मेल्यो` → `गर्न मिल्यो`, and `is finally heard` → `is finally here`.
- Non-word transcript spellings are corrected globally: `साँढै` → चाँडै,
  `सिद्धै` → सिधै, `छै` → छ, `चै`/`चे` → चाहिँ, `लाइचे` → लाई, and
  `गरिहेरे` → गरें.

### Spelling variants now covered

The glossary includes these common ASR spelling variants. Add the spelling that
appears in a real transcript rather than guessing:

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

Case-suffix coverage:

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
  वाईफाई are not handled by a single-token lookup. Product names are covered by
  `merge_english_phrase` (ChatGPT, OpenAI); add other two-word terms to that
  table rather than inventing a suffix-only rule. A phrase correction may merge
  tokens only when a second model or the audio confirms the intended name,
  because merging changes the caption's word count.
- **Suffix stripping is greedy.** A glossary word that legitimately ends in a
  suffix-like string must be a direct key (direct lookup runs first). Audit new
  entries for this.
- **Mixed-script rendering.** The renderer picks the font per caption group:
  Latin-only groups keep the user's chosen face, and groups with Devanagari use
  the selected face only if it supports Devanagari, otherwise a bundled
  Devanagari fallback such as Mukta. Bundled Devanagari faces also contain
  Latin glyphs for mixed words like `GBदेखि`.
- **Spelling consistency.** Use तपाईं (anusvara) consistently; the
  `NEPALI_WORD_CORRECTIONS` map in `backend/app/services/nepali_terms.py` maps
  तव्य → तपाईँ (chandrabindu), while the UI and README use तपाईं. Both are
  valid, but pick one.

## 7. Test phrases

Use these as ASR/translation smoke tests.

| Nepali | Roman Nepali | English |
|---|---|---|
| नमस्ते, मेरो नाम शाहिल हो। | Namaste, mero naam Shahil ho. | Hello, my name is Shahil. |
| तपाईंलाई कस्तो छ? | Tapailai kasto chha? | How are you? (formal) |
| म ठीक छु, धन्यवाद। | Ma thik chhu, dhanyabaad. | I'm fine, thank you. |
| आज हामी काठमाडौंमा भेट्यौं। | Aaja hami Kathmanduma bhetyaun. | We met in Kathmandu today. |
| उहाँले भन्नुभयो, “यो राम्रो छ।” | Uhaanle bhannu bhayo, “Yo ramro chha.” | He/she said, "This is good." |
| मैले काम गरें। | Maile kaam garen. | I did the work. |
| उनीहरू घर गए। | Uniharu ghar gaye. | They went home. |
| हिजो पानी पर्यो। | Hijo paani paryo. | It rained yesterday. |
| भोलि बिहान बैठक हुनेछ। | Bholi bihaan baithak hunechha. | There will be a meeting tomorrow morning. |
| मलाई नेपाली सिक्न मन लाग्छ। | Malai Nepali sikna man lagchha. | I want to learn Nepali. |
| उसले सोध्यो, “तिमी कहाँ जान्छौ?” | Usle sodhyo, “Timi kahaan jaanchhau?” | He asked, "Where are you going?" |
| यो भिडियो धेरै राम्रो छ; सबैले हेर्नुपर्छ। | Yo video dherai ramro chha; sabaile hernu parchha. | This video is really good; everyone should watch it. |
| कृपया माइक्रोफोन अलि नजिक राख्नुहोस्। | Kripaya microphone ali najik rakhnu hos. | Please keep the microphone a little closer. |
| हामीले आजै काम सक्नुपर्छ। | Hamile aajai kaam saknu parchha. | We have to finish the work today itself. |
| उहाँहरू त्यहाँ रहे। | Uhaanharu tyahaan rahe. | They stayed there. |
| यो ल्यापटपको ब्याट्री राम्रो छ, तर विन्डोज अपडेट ढिलो हुन्छ। | Yo laptop ko battery ramro chha, tar Windows update dhilo hunchha. | This laptop's battery is good, but Windows updates are slow. |
| मिटिङ साढे तीन बजे सुरु हुनेछ। | Meeting saadhe teen baje suru hunechha. | The meeting will start at 3:30. |
| उहाँले दशैंमा घर जानुभयो। | Uhaanle Dashainma ghar janu bhayo. | He/she went home for Dashain. |
| यो काम सजिलो छैन, तर गर्न सकिन्छ। | Yo kaam sajilo chhaina, tar garna sakinchha. | This work isn't easy, but it can be done. |
| मलाई थाहा छैन, उहाँ आउनुहुन्छ कि हुँदैन। | Malai thaahaa chhaina, uhaan aunu hunchha ki hudaina. | I don't know whether he/she is coming. |

## 8. Roman Nepali captions

CutClipper can burn the Nepali caption track in either **Devanagari** or
**Roman Nepali**. The choice is `CaptionSettings.nepali_script`
(`"devanagari"` or `"roman"`) and appears in the Caption studio and the clip
settings. The transcript editor stays in Devanagari; when Roman is selected,
each line shows its Roman caption underneath, the live preview switches to
Roman, and the SRT and rendered MP4 use Roman.

### Scheme

The scheme is practical Roman Nepali without diacritics, chosen to read like
the Roman Nepali Nepali speakers already type:

| Devanagari | Roman | Notes |
|---|---|---|
| आ | aa | Long ā is written aa. |
| इ / ई | i / ee | The fallback keeps the distinction; the lexicon uses the conventional spelling for common words (thik, din). |
| उ / ऊ | u / oo | Same rule; common words use conventional forms (guru, uniharu). |
| ए / ऐ / ओ / औ | e / ai / o / au | |
| अं / अँ | n (m before प फ ब भ म) | Anusvara assimilates to a labial nasal. |
| क ख ग घ | k kh g gh | |
| च छ ज झ | ch chh j jh | छ is always chh, so छ is chha. |
| ट ठ ड ढ / त थ द ध | t th d dh / t th d dh | Retroflex and dental series merge, as in everyday Roman Nepali. |
| प फ ब भ म | p ph b bh m | |
| य र ल व | y r l b/w | व is b on its own (विकास → bikaas) and w inside a cluster (स्वागत → swaagat, द्वारा → dwara, विश्व → bishwa). |
| श ष स ह | sh sh s h | |
| क्ष त्र ज्ञ श्र | ksh tr gy shr | ज्ञ is /gy/ in Nepali, not jnya. |
| ड़ / ढ़ | d / dh | ASR sometimes adds a nukta to plain ड/ढ; both read d/dh. |
| ज़ / फ़ / क़ / ग़ | z / f / q / gh | Loanword sounds keep their Latin equivalents. |
| । / ॥ | . | Danda becomes a full stop. |
| ०–९ | 0–9 | Devanagari digits become ASCII digits. |

Inherent **अ** is written as `a`, then deleted word-finally unless the final
consonant follows a virama or is छ (`गर्न` → garna, `गर्छ` → garchha, `काम` →
kaam, `राम` → raam). This is the rule that keeps `गर्न` and `काम` apart without
a dictionary. Dependent gerunds keep the final `a`: `गरेर` → garera,
`बोलेर` → bolera, `गएर` → gaera, `लिएर` → liyera. Short imperatives do not:
`हेर` → her, `फेर` → pher. Names and unusual words use this fallback; common
words use the curated lexicon so their conventional spelling wins.

A full stop inside a token only starts a new sentence when no letter or digit
follows it. This keeps `GPT .५` and `v१.५` from capitalising the next word,
while a danda still ends a sentence even with no space after it
(`नमस्ते।धन्यवाद` → `Namaste.Dhanyabaad`).

### English stays English

The romanizer never transliterates Latin text. It also runs the existing
Devanagari → English glossary first, so known English loans keep their English
spelling:

- `यो भिडियो धेरै राम्रो छ` → `Yo video dherai ramro chha`
- `विन्डोजमा` → `Windows ma`
- `YouTubeमा` → `YouTube ma` (Latin stem + separated Roman Nepali suffix)
- `कम्पनीहरूले` → `company harule`
- `सीईओ` → `CEO`, `यूएसए` → `USA`, `डलर` → `dollar`, `प्रतिशत` → `percent`
- `GPT ४` → `GPT 4`, `२२ प्रतिशत` → `22 percent` (Devanagari digits
  next to English labels become ASCII)
- `This is English.` → unchanged

If a mixed token has an English word that is not in the glossary, the fallback
writes it phonetically in Roman letters. Add the spelling to
`backend/assets/nepali-english-terms.json` to keep it English.

### Files and data

- `backend/app/services/romanize.py` — transliterator, lexicon lookup, suffix
  handling, sentence casing, and the segment/word helpers.
- `backend/assets/nepali-roman-lexicon.json` — `words` for conventional
  spellings and `suffixes` for case endings and plurals. Whole-word lookup runs
  before longest-suffix decomposition, so an ordinary word is never split just
  because it ends in a suffix-like string.
- `backend/app/services/nepali_terms.py` — shared spelling corrections and the
  English loanword glossary used by both the transcriber and romanizer.
- `POST /api/captions/romanize` — romanizes segments for the live editor. The
  renderer applies the same function server-side, so the preview, SRT, and
  burned captions agree.
- `backend/tests/test_romanize.py` — phrase-level and rendering tests.
- `backend/tests/test_nepali_codeswitch.py` — the real-transcript regression
  corpus. It replays every line of the 57-second Nepali/English tech video
  (`ChatGPT`, `OpenAI`, `iOS`, `Android`, `UI/UX`) through the normal
  word-normalization and caption-grouping path, then checks both the
  Devanagari/Latin caption and its Roman form. Add a case here whenever a real
  mixed-language transcript exposes a new error.

### Adding a word or fixing a spelling

1. Add the Devanagari source to `words` in `nepali-roman-lexicon.json` only if
   the conventional Roman spelling differs from the rule-based fallback (for
   example `ठीक` → thik, `काठमाडौं` → Kathmandu, `दिए` → diye).
2. Prefer whole words for irregular verb forms; use `suffixes` only for real
   case endings and plurals.
3. Keep English loanwords in the English glossary, not the Roman lexicon. The
   romanizer will then preserve their Latin spelling.
4. Add the phrase to `backend/tests/test_romanize.py` so the spelling cannot
   regress.
5. Names are the hardest fallback case. Use hotwords or add a lexicon entry if
   a person or place has an established Roman spelling.

## 9. Where this plugs into CutClipper

- Language codes and detection: `backend/app/api/routes.py` (`ne`, `en` only;
  Hindi-like detections are folded into `ne` so the UI never offers Hindi).
- Nepali models, prompt, chunking, coverage repair, warnings, punctuation and
  spelling rules: `backend/app/services/transcriber.py`. The accurate model
  transcribes 12-second overlapping windows, then `_repair_accurate_gaps`
  re-decodes any speech region (found with ffmpeg `silencedetect`) that has a
  wordless hole longer than 1.5 seconds.
- Word-level timing: `CaptionSegment.words` carries the ASR's exact word times;
  `words_from_segments` uses them when the line still has the same token count
  and otherwise distributes time by syllable weight (`app/pipeline/timing.py`).
- Script tagging: `build_caption_segments` labels each line `ne`, `en`, or
  `mixed`; `build_ass` keeps the requested font for Latin-only groups and uses
  a Devanagari fallback only for groups that contain Devanagari.
- Devanagari → Latin glossary: `backend/assets/nepali-english-terms.json` and
  `english_term_for` in `backend/app/services/nepali_terms.py`. The transcriber
  applies it while normalising ASR words.
- Transcript cache refresh: `_refresh_cached_transcript` in
  `backend/app/api/routes.py` runs `normalize_cached_words` when a
  `transcript_v4_*.json` cache is loaded. Cached ASR text therefore picks up
  the current spelling, product-name merge, and context fixes without a slow
  re-transcription.
- Roman Nepali: `backend/app/services/romanize.py`, the curated
  `backend/assets/nepali-roman-lexicon.json`, and
  `POST /api/captions/romanize`. `build_ass` applies the same transliterator
  before grouping so the preview and burned output agree.
- Caption editor on every page except home:
  `frontend/src/components/CaptionEditorPanel.tsx` is the shared drawer for
  text, timing, split/merge/add/delete, and the देवनागरी/Roman toggle. Edits
  save instantly to `frontend/src/lib/captionDrafts.ts` (localStorage) and
  update the `.SRT` download without a render. Switching to Roman edits the
  Roman track directly; the Devanagari source stays canonical for translation.
  On the Download screen the drawer loads the burned-in lines from
  `GET /api/jobs/{id}/captions`. The player previews the clean source from
  `GET /api/jobs/{id}/source` with the live caption overlay, so text, size, and
  position edits update immediately without touching the rendered MP4.
  Downloading the clip automatically sends the current track and style to
  `POST /api/jobs/{id}/restyle`, waits for that fresh render, and downloads it;
  there is no separate **Update video** step. The download button in the shared
  drawer does the same from the other screens when a completed export exists.
  On the Style screen the edited lines are passed to the next `POST /api/jobs`
  render. Roman is used for the render when it has manual edits; otherwise the
  server transliterates the source. The same drawer can generate an English
  subtitle track with `POST /api/captions/translate` (upload) or
  `POST /api/jobs/{id}/translate` (finished export), and exposes caption
  density controls (`CaptionSettings.max_words` / `max_lines`) so the renderer
  and live preview group only a readable number of words and lines at a time.
- Nepali → English translation prompt: `backend/app/services/translator.py`.
  English-only lines are kept unchanged; only Nepali and mixed lines are sent
  through translation. Translation always uses the canonical Devanagari lines,
  never the Roman display copy.
- Dual-track burned captions and danda/spacing cleanup:
  `backend/app/pipeline/captions.py`.
- Devanagari caption fonts: `frontend/src/lib/captionFonts.json`
  (Mukta, Noto Sans Devanagari, Hind, Kalam, Rajdhani, Tiro Devanagari Hindi,
  Yatra One, Teko, Baloo 2).
- Hotwords: `CUTCLIPPER_NEPALI_HOTWORDS` — names/places, not common words.

## 10. Maintenance checklist

When adding a Nepali correction or glossary entry:

0. Replay the real ASR output through
   `backend/tests/test_nepali_codeswitch.py` first. If the line is not in the
   corpus, add it with the expected Devanagari/Latin and Roman forms before
   changing the code.
1. Confirm the source spelling is a real ASR output, not a guess.
2. Check for name collisions and context-dependent meanings.
3. Add the common spelling variants.
4. Check whether a case suffix can attach; add suffix variants if needed.
5. Add a unit test in `backend/tests/test_transcriber_runtime.py` and replay
   the line in `backend/tests/test_nepali_codeswitch.py`.
6. Keep word timings and token boundaries intact; never rewrite a word into
   multiple tokens. Merging two adjacent ASR tokens into one confirmed product
   name is allowed through `merge_english_phrase`, using the first word's start
   and the second word's end.
7. Prefer hotwords for names and places; keep corrections for non-words.
8. For Roman Nepali, add conventional spellings to
   `backend/assets/nepali-roman-lexicon.json` and a phrase test in
   `backend/tests/test_romanize.py`. Do not add English loans there; add them
   to `nepali-english-terms.json` so they stay in English.
9. When changing the Roman scheme, update the table in section 8 and rerun
   `pytest backend/tests/test_romanize.py`.
