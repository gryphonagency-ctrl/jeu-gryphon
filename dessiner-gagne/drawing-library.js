'use strict';

const DRAWINGS = [
  {
    word: 'soleil',
    svg: '<g><path fill="#f3a83b" d="M200 78 219 116 261 101 255 145 300 153 276 190 311 219 269 238 278 281 236 272 216 313 190 278 151 298 151 254 109 245 133 208 101 177 144 162 140 119 181 135Z"/><circle fill="#ffd75e" cx="200" cy="200" r="67"/><path fill="none" d="M174 189q10-12 20 0m18 0q10-12 20 0m-48 24q16 22 35 0"/></g>'
  },
  {
    word: 'pomme',
    svg: '<g><path fill="#e9574f" d="M200 145q-18-22-47-10-47 15-38 78 11 82 62 91 19 3 28-12 10 15 29 12 51-9 61-91 8-63-39-78-29-12-51 10-3-3-5 0Z"/><path fill="#71503b" d="M199 143q-2-26 13-39"/><path fill="#77ad58" d="M205 126q24-32 52-17-12 28-52 17Z"/><path fill="none" d="M156 186q-10 29 0 49"/></g>'
  },
  {
    word: 'maison',
    svg: '<g><path fill="#f1c878" d="m93 190 107-91 107 91v120H93Z"/><path fill="#d96850" d="m79 190 121-105 121 105-16 18-105-91-105 91Z"/><path fill="#9dc8df" d="M119 207h52v48h-52z"/><path fill="#9dc8df" d="M229 207h52v48h-52z"/><path fill="#9d6651" d="M176 245h49v65h-49z"/><path fill="none" d="M145 207v48m-26-24h52m84-24v48m-26-24h52"/></g>'
  },
  {
    word: 'poisson',
    svg: '<g><path fill="#5bb5cf" d="M105 200q43-72 137-49 32 8 55 49-23 41-55 49-94 23-137-49Z"/><path fill="#f1a94d" d="m103 200-47-45v90Z"/><path fill="#f6ce5a" d="m174 156 33-37 28 44m-61 81 33 37 28-44Z"/><circle cx="251" cy="187" r="7" fill="#403b45"/><path fill="none" d="M144 203q30 10 0 22"/></g>'
  },
  {
    word: 'chat',
    svg: '<g><path fill="#e7a46d" d="m111 150-12-67 65 34q37-15 73 0l64-34-12 70q19 29 11 74-11 65-100 70-89-5-100-70-8-45 11-77Z"/><path fill="#f4d0aa" d="M133 210q20-25 43 0-23 24-43 0Zm91 0q23-25 43 0-23 24-43 0Z"/><circle cx="157" cy="207" r="7" fill="#403b45"/><circle cx="249" cy="207" r="7" fill="#403b45"/><path fill="#dc7d6a" d="M180 248q20-20 40 0-20 24-40 0Z"/><path fill="none" d="M190 254q10 8 20 0"/></g>'
  },
  {
    word: 'voiture',
    svg: '<g><path fill="#e85f54" d="m91 219 22-48q10-22 34-22h98q25 0 39 26l24 44q25 8 25 34v35H67v-35q0-26 24-34Z"/><path fill="#9ed3e5" d="m132 173-18 43h73v-43Zm70 0v43h83l-21-37q-5-6-15-6Z"/><circle cx="123" cy="284" r="25" fill="#403b45"/><circle cx="123" cy="284" r="11" fill="#d9d4ca"/><circle cx="282" cy="284" r="25" fill="#403b45"/><circle cx="282" cy="284" r="11" fill="#d9d4ca"/><path fill="none" d="M84 244h25m191 0h19"/></g>'
  },
  {
    word: 'fleur',
    svg: '<g><path fill="#77aa5b" d="M191 207h18v105h-18z"/><path fill="#78b45d" d="M198 260q-49-34-71-2 34 31 71 15m5-37q43-35 67-8-29 34-67 23"/><g fill="#e8789a"><ellipse cx="200" cy="139" rx="28" ry="43"/><ellipse cx="200" cy="237" rx="28" ry="43"/><ellipse cx="151" cy="188" rx="43" ry="28"/><ellipse cx="249" cy="188" rx="43" ry="28"/><ellipse cx="166" cy="154" rx="28" ry="39" transform="rotate(-45 166 154)"/><ellipse cx="234" cy="154" rx="28" ry="39" transform="rotate(45 234 154)"/><ellipse cx="166" cy="222" rx="28" ry="39" transform="rotate(45 166 222)"/><ellipse cx="234" cy="222" rx="28" ry="39" transform="rotate(-45 234 222)"/></g><circle cx="200" cy="188" r="31" fill="#f5c84f"/></g>'
  },
  {
    word: 'arbre',
    svg: '<g><path fill="#9b6749" d="M177 207h46v104h-46z"/><circle cx="151" cy="166" r="59" fill="#70ae61"/><circle cx="224" cy="148" r="67" fill="#7fba69"/><circle cx="252" cy="205" r="53" fill="#64a653"/><circle cx="161" cy="218" r="48" fill="#7eb764"/></g>'
  },
  {
    word: 'bateau',
    svg: '<g><path fill="#5385a8" d="M83 232h234l-35 64H128Z"/><path fill="#f1c978" d="M190 108h14v124h-14z"/><path fill="#e66f5c" d="M181 120 103 220h78Z"/><path fill="#fffdf8" d="M214 135v85h73Z"/><path fill="none" d="M91 315q25-14 50 0t50 0 50 0 50 0"/></g>'
  },
  {
    word: 'parapluie',
    svg: '<g><path fill="#e96b70" d="M81 190q10-91 119-103 108 12 119 103-37-38-79 0-40-39-80 0-41-38-79 0Z"/><path fill="#f5cd58" d="M200 87v14q-1 48-40 89-40-39-79 0Z"/><path fill="#78b8cf" d="M200 87v14q1 48 40 89 40-39 79 0Z"/><path fill="#78b8cf" d="M200 188v91q0 35 27 35 24 0 24-26"/></g>'
  },
  {
    word: 'champignon',
    svg: '<g><path fill="#e75e50" d="M86 183q10-93 114-96 105 3 114 96-45 17-78-4-36 24-72 0-33 21-78 4Z"/><path fill="#fffdf8" d="M174 189h52l14 110q-38 22-80 0Z"/><ellipse cx="151" cy="150" rx="12" ry="17" fill="#fffdf8"/><ellipse cx="215" cy="119" rx="13" ry="17" fill="#fffdf8"/><ellipse cx="260" cy="157" rx="12" ry="16" fill="#fffdf8"/><path fill="none" d="M188 226v39m26-39v39"/></g>'
  },
  {
    word: 'tasse',
    svg: '<g><path fill="#f3c75e" d="M104 137h172v145q0 27-27 27h-118q-27 0-27-27Z"/><path fill="none" d="M276 170h28q39 0 29 45-7 32-57 32M135 111h109"/></g>'
  },
  {
    word: 'glace',
    svg: '<g><path fill="#d9a06d" d="m164 233 36 83 36-83Z"/><path fill="#e7799b" d="M145 239q-42-10-34-54 4-25 29-34-5-42 38-47 35-5 48 27 38-6 47 28 10 38-24 59-42 28-104 21Z"/><path fill="none" d="m147 178 13 13m76-38 9 10"/></g>'
  },
  {
    word: 'pizza',
    svg: '<g><path fill="#e9b65d" d="m100 277 100-185 101 185q-99 54-201 0Z"/><path fill="#e86b51" d="m115 269 85-157 86 157q-85 43-171 0Z"/><circle cx="170" cy="216" r="15" fill="#b94e42"/><circle cx="228" cy="252" r="15" fill="#b94e42"/><circle cx="216" cy="175" r="14" fill="#b94e42"/><path fill="none" d="M149 285q50 18 102 0"/></g>'
  },
  {
    word: 'fraise',
    svg: '<g><path fill="#e84f58" d="M109 145q42-31 91 4 48-35 91-4 18 35-9 91-28 58-82 89-53-31-81-89-28-56-10-91Z"/><path fill="#6ba65c" d="m200 151-41-48 40 20 19-36 2 38 38-24-31 51Z"/><g fill="#f9da72" stroke="none"><ellipse cx="157" cy="181" rx="4" ry="7"/><ellipse cx="206" cy="185" rx="4" ry="7"/><ellipse cx="249" cy="183" rx="4" ry="7"/><ellipse cx="177" cy="226" rx="4" ry="7"/><ellipse cx="228" cy="232" rx="4" ry="7"/><ellipse cx="199" cy="272" rx="4" ry="7"/></g></g>'
  },
  {
    word: 'lune',
    svg: '<g><path fill="#f2c95a" d="M241 87q-78 42-69 116 8 75 84 100-35 15-72 3-89-28-83-124 7-96 108-95 16 0 32 0Z"/><circle cx="262" cy="143" r="9" fill="#f3c75e" stroke="none"/><circle cx="291" cy="185" r="6" fill="#f3c75e" stroke="none"/><circle cx="264" cy="226" r="7" fill="#f3c75e" stroke="none"/></g>'
  },
  {
    word: 'papillon',
    svg: '<g><path fill="#e8799a" d="M190 190q-75-114-112-47-30 58 99 72-93 30-58 78 39 49 83-70Z"/><path fill="#77b8ce" d="M210 190q75-114 112-47 30 58-99 72 93 30 58 78-39 49-83-70Z"/><path fill="#f1c85a" d="M189 169h22v83h-22z"/><path fill="none" d="m193 174-27-40m42 40 27-40"/></g>'
  },
  {
    word: 'ballon',
    svg: '<g><path fill="#e96a72" d="M200 75q-83 0-80 95 3 73 73 105l7 14 7-14q70-32 73-105 3-95-80-95Z"/><path fill="#f6c75e" d="m190 279 10 13 10-13-10-10Z"/><path fill="none" d="M200 292q-34 34 0 56t0 42"/></g>'
  },
  {
    word: 'carotte',
    svg: '<g><path fill="#ee9746" d="m116 113 172 36-101 153q-17 19-30-4L105 148q-7-25 11-35Z"/><path fill="#71aa5c" d="m116 117-37-45q44 3 68 43-12-50 13-77 23 48-2 83 42-33 75-22-31 39-84 30Z"/><path fill="none" d="m144 155 23 8m-8 26 23 7m-8 26 22 7"/></g>'
  },
  {
    word: 'poire',
    svg: '<g><path fill="#8fbb5e" d="M193 99q-5 45-25 70-64 23-57 91 8 75 89 76 81-1 89-76 7-68-57-91-20-25-25-70Z"/><path fill="#76503c" d="M195 115q-1-26 17-42"/><path fill="#d8e58b" d="M147 242q6-38 34-48-7 37-34 48Z"/></g>'
  },
  {
    word: 'canard',
    svg: '<g><path fill="#f1c94f" d="M100 229q5-65 91-69 72-2 95 47 38 1 54 28-29 28-71 12-29 70-111 58-61-9-58-76Z"/><path fill="#e87955" d="m323 207 43 16-43 17Z"/><circle cx="260" cy="194" r="7" fill="#403b45"/><path fill="none" d="M134 279q40 18 77 0"/></g>'
  },
  {
    word: 'escargot',
    svg: '<g><path fill="#86b95e" d="M79 260q3-45 49-45h197q-1 73-81 85H111q-32 0-32-40Z"/><circle cx="184" cy="194" r="72" fill="#e6a56d"/><path fill="none" d="M185 194q-1-43-39-38-35 5-27 39 6 25 35 20 18-3 15-20-2-12-15-10"/><path fill="none" d="m302 219 1-49m30 49 1-49"/><circle cx="303" cy="163" r="8" fill="#403b45"/><circle cx="334" cy="163" r="8" fill="#403b45"/></g>'
  },
  {
    word: 'avion',
    svg: '<g><path fill="#8fc8df" d="m200 75 29 115 102 61-9 21-99-31-10 94-25 0-10-94-99 31-9-21 102-61Z"/><path fill="#fffdf8" d="m200 150-20 57 20-10 20 10Z"/></g>'
  },
  {
    word: 'guitare',
    svg: '<g><path fill="#e6a65f" d="M183 190q-34-32-72-9-49 29-24 80 22 46 69 20 29-16 38-39h25q9 23 38 39 47 26 69-20 25-51-24-80-38-23-72 9h-47Z"/><path fill="#9b6749" d="M189 105h22v113h-22z"/><path fill="#e6a65f" d="M183 85h34v37h-34z"/><circle cx="200" cy="227" r="20" fill="#9b6749"/><path fill="none" d="M194 94v123m12-123v123"/></g>'
  },
  {
    word: 'horloge',
    svg: '<g><circle cx="200" cy="200" r="112" fill="#fffdf8"/><circle cx="200" cy="200" r="88" fill="#f2d579"/><path fill="none" d="M200 130v74l54 34"/><path fill="none" d="M200 101v13m70 16-9 9m38 61h-13m-16 70-9-9m-61 38v-13m-70-16 9-9m-38-61h13m16-70 9 9"/></g>'
  },
  {
    word: 'bus',
    svg: '<g><path fill="#f0c84e" d="M105 91h190q24 0 24 28v151q0 24-24 24H105q-24 0-24-24V119q0-28 24-28Z"/><path fill="#91cadd" d="M104 122h192v81H104z"/><path fill="#fffdf8" d="M112 132h77v60h-77zm88 0h87v60h-87z"/><circle cx="135" cy="290" r="24" fill="#403b45"/><circle cx="265" cy="290" r="24" fill="#403b45"/><path fill="none" d="M106 224h186m-154 0v25m103-25v25"/></g>'
  },
  {
    word: 'gâteau',
    svg: '<g><path fill="#e88e9c" d="M91 187h218v113H91z"/><path fill="#f5d477" d="M91 187q28-49 54 0 27-49 54 0 27-49 54 0 28-49 56 0v37H91Z"/><path fill="#8fc8df" d="M135 114h14v52h-14zm58-19h14v71h-14zm58 19h14v52h-14z"/><path fill="#e96859" d="M142 82q-20 22 0 31 21-9 0-31Zm58-19q-20 22 0 31 21-9 0-31Zm58 19q-20 22 0 31 21-9 0-31Z"/><path fill="none" d="M120 239h160m-142 32h124"/></g>'
  },
  {
    word: 'cœur',
    svg: '<g><path fill="#e85f68" d="M200 302 92 197q-37-39-8-81 32-46 87-13l29 28 29-28q55-33 87 13 29 42-8 81Z"/><path fill="none" d="M122 180q20-23 40 0"/></g>'
  },
  {
    word: 'lapin',
    svg: '<g><ellipse cx="164" cy="125" rx="31" ry="83" fill="#eee7dc" transform="rotate(-14 164 125)"/><ellipse cx="236" cy="125" rx="31" ry="83" fill="#eee7dc" transform="rotate(14 236 125)"/><ellipse cx="200" cy="224" rx="91" ry="80" fill="#eee7dc"/><circle cx="169" cy="213" r="8" fill="#403b45"/><circle cx="231" cy="213" r="8" fill="#403b45"/><path fill="#e87991" d="M190 232q10-12 20 0-10 18-20 0Z"/><path fill="none" d="M185 248q15 14 30 0m-30 2-38-7m38 17-35 8m65-18 38-7m-38 17 35 8"/><circle cx="157" cy="282" r="26" fill="#fffdf8"/><circle cx="243" cy="282" r="26" fill="#fffdf8"/></g>'
  }
];

module.exports = { DRAWINGS };
