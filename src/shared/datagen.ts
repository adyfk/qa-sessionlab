/** Test data generator. Pure functions; no network. */

const FIRST = ['Adi', 'Budi', 'Citra', 'Dewi', 'Eko', 'Fajar', 'Gita', 'Hana', 'Indra', 'Joko', 'Kartika', 'Lina', 'Maya', 'Nanda', 'Oki', 'Putri', 'Rina', 'Sari', 'Tono', 'Wulan', 'Alice', 'Bob', 'Carol', 'David', 'Emma', 'Liam', 'Noah', 'Olivia', 'Sofia', 'Yuki'];
const LAST = ['Pratama', 'Saputra', 'Wijaya', 'Santoso', 'Hidayat', 'Kusuma', 'Lestari', 'Nugroho', 'Siregar', 'Situmorang', 'Smith', 'Johnson', 'Brown', 'Tanaka', 'Garcia', 'Müller', "O'Connor", 'Nguyen'];
const STREETS = ['Jl. Sudirman', 'Jl. Thamrin', 'Jl. Gatot Subroto', 'Jl. Diponegoro', 'Jl. Merdeka', 'Jl. Asia Afrika', 'Jl. Malioboro'];
const CITIES: [string, string, string][] = [
  ['Jakarta Selatan', 'DKI Jakarta', '12190'], ['Bandung', 'Jawa Barat', '40111'], ['Surabaya', 'Jawa Timur', '60271'],
  ['Yogyakarta', 'DI Yogyakarta', '55213'], ['Denpasar', 'Bali', '80113'], ['Medan', 'Sumatera Utara', '20112'], ['Makassar', 'Sulawesi Selatan', '90111'],
];
const COMPANIES = ['PT Maju Jaya', 'CV Sinar Abadi', 'Acme Corp', 'Globex', 'PT Nusantara Digital', 'Initech'];

let seq = 0;
export const rnd = (n: number) => Math.floor(Math.random() * n);
export const pick = <T>(a: readonly T[]): T => a[rnd(a.length)];
const digits = (n: number) => Array.from({ length: n }, () => rnd(10)).join('');
const stamp = () => {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear() % 100}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export function uniqueTag(): string {
  seq = (seq + 1) % 1000;
  return `${stamp()}${String(seq).padStart(3, '0')}`;
}

export interface Person {
  firstName: string; lastName: string; fullName: string; username: string; email: string; phone: string;
  password: string; birthDate: string; company: string; street: string; city: string; province: string;
  postalCode: string; country: string; nik: string; npwp: string;
}

export function person(emailDomain = 'example.test'): Person {
  const firstName = pick(FIRST);
  const lastName = pick(LAST);
  const tag = uniqueTag();
  const base = `${firstName}.${lastName}`.toLowerCase().normalize('NFD').replace(/[^a-z.]/g, '');
  const [city, province, postalCode] = pick(CITIES);
  const y = 1970 + rnd(35), m = 1 + rnd(12), d = 1 + rnd(28);
  return {
    firstName, lastName, fullName: `${firstName} ${lastName}`,
    username: `qa_${base.replace('.', '_')}_${tag.slice(-6)}`,
    email: `qa+${base}.${tag}@${emailDomain}`,
    phone: `+628${1 + rnd(9)}${digits(9)}`,
    password: strongPassword(),
    birthDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
    company: pick(COMPANIES), street: `${pick(STREETS)} No. ${1 + rnd(200)}`, city, province, postalCode, country: 'Indonesia',
    nik: `3${digits(15)}`, npwp: `${digits(2)}.${digits(3)}.${digits(3)}.${digits(1)}-${digits(3)}.${digits(3)}`,
  };
}

export function strongPassword(len = 14): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%^&*-_+='];
  const all = sets.join('');
  const chars = sets.map((s) => s[rnd(s.length)]);
  while (chars.length < len) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/** Publicly documented sandbox test card numbers (accepted by Stripe/Adyen/Braintree/Midtrans sandboxes). */
export const KNOWN_TEST_CARDS: Record<'visa' | 'mastercard' | 'amex', string[]> = {
  visa: ['4111111111111111', '4242424242424242', '4000056655665556'],
  mastercard: ['5555555555554444', '5200828282828210', '5105105105105100'],
  amex: ['378282246310005', '371449635398431'],
};

/** A sandbox test card (never a real card) with a future expiry. */
export function testCard(brand: 'visa' | 'mastercard' | 'amex' = 'visa'): { number: string; expiry: string; cvc: string; brand: string } {
  const body = pick(KNOWN_TEST_CARDS[brand]);
  const d = new Date();
  const exp = `${String(1 + rnd(12)).padStart(2, '0')}/${String((d.getFullYear() + 2 + rnd(3)) % 100).padStart(2, '0')}`;
  return { number: body, expiry: exp, cvc: digits(brand === 'amex' ? 4 : 3), brand };
}

export function luhnCheckDigit(partial: string): string {
  let sum = 0;
  for (let i = 0; i < partial.length; i++) {
    let n = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return String((10 - (sum % 10)) % 10);
}

export function luhnValid(num: string): boolean {
  return luhnCheckDigit(num.slice(0, -1)) === num.slice(-1);
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Edge-case strings for negative / robustness testing of input fields. */
export const EDGE_CASES: Record<string, { label: string; value: () => string }> = {
  empty: { label: 'Empty string', value: () => '' },
  spaces: { label: 'Only whitespace', value: () => '    ' },
  trim: { label: 'Leading/trailing spaces', value: () => '  value  ' },
  long255: { label: '255 chars', value: () => 'a'.repeat(255) },
  long256: { label: '256 chars (boundary+1)', value: () => 'a'.repeat(256) },
  long5k: { label: '5,000 chars', value: () => 'Lorem ipsum '.repeat(417).slice(0, 5000) },
  unicode: { label: 'Unicode / accents', value: () => 'Zoë Ångström Ñandú — 東京 Привет' },
  emoji: { label: 'Emoji (surrogate pairs)', value: () => '👩‍💻🚀🇮🇩 test 😀' },
  rtl: { label: 'RTL text', value: () => 'مرحبا بالعالم שלום' },
  zeroWidth: { label: 'Zero-width chars', value: () => 'ab​cd‍fe﻿' },
  quotes: { label: "Quotes ' \" `", value: () => `O'Reilly "quoted" \`tick\`` },
  sqlQuote: { label: 'SQL quote probe', value: () => "' OR '1'='1" },
  htmlTag: { label: 'HTML escaping probe', value: () => '<b>bold</b><img src=x onerror=alert(1)>' },
  templateInj: { label: 'Template probe', value: () => '{{7*7}} ${7*7} <%= 7*7 %>' },
  pathTraversal: { label: 'Path probe', value: () => '../../etc/passwd' },
  negative: { label: 'Negative number', value: () => '-1' },
  zero: { label: 'Zero', value: () => '0' },
  decimal: { label: 'Decimal comma', value: () => '1.234,56' },
  bigInt: { label: 'Huge number', value: () => '9999999999999999999999' },
  maxInt32: { label: 'INT32 max+1', value: () => '2147483648' },
  sciNotation: { label: 'Scientific notation', value: () => '1e308' },
  dateInvalid: { label: 'Invalid date', value: () => '2024-02-30' },
  dateLeap: { label: 'Leap day', value: () => '2024-02-29' },
  emailPlus: { label: 'Email with +tag', value: () => `qa+${uniqueTag()}@example.test` },
  emailInvalid: { label: 'Invalid email', value: () => 'not-an-email@' },
  emailIdn: { label: 'IDN email', value: () => 'pengguna@contoh.indonesia' },
  newline: { label: 'Multi-line', value: () => 'line1\nline2\r\nline3' },
  nullStr: { label: '"null" / "undefined"', value: () => 'null' },
};

export type FieldKind =
  | 'email' | 'password' | 'firstName' | 'lastName' | 'fullName' | 'username' | 'phone' | 'company'
  | 'street' | 'city' | 'province' | 'postalCode' | 'country' | 'date' | 'number' | 'url' | 'card'
  | 'cardExpiry' | 'cvc' | 'nik' | 'npwp' | 'otp' | 'search' | 'text' | 'textarea';

/** Heuristically classify an input from its attributes. */
export function classifyField(attrs: { type?: string; name?: string; id?: string; placeholder?: string; autocomplete?: string; label?: string; tag?: string }): FieldKind {
  const type = (attrs.type || '').toLowerCase();
  const norm = (s: string) => s.replace(/[_\-.]+/g, ' ');
  const hay = norm([attrs.name, attrs.id, attrs.placeholder, attrs.autocomplete, attrs.label].join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
  const words = new Set(hay.split(/[^a-z0-9]+/).filter(Boolean));
  // Short tokens ("hp", "tel", "nik") must be whole words so "hotel" ≠ phone; long tokens may be substrings.
  const has = (...w: string[]) => w.map(norm).some((x) => (x.length >= 5 || x.includes(' ') ? hay.includes(x) : words.has(x)));
  if (type === 'email' || has('email', 'e-mail', 'surel')) return 'email';
  if (type === 'password' || has('password', 'passwd', 'sandi', 'pwd')) return 'password';
  if (has('otp', 'one-time', 'verification code', 'kode verifikasi')) return 'otp';
  if (has('cc-number', 'card number', 'cardnumber', 'nomor kartu')) return 'card';
  if (has('cc-exp', 'expiry', 'expiration', 'kadaluarsa')) return 'cardExpiry';
  if (has('cvc', 'cvv', 'csc')) return 'cvc';
  if (type === 'tel' || has('phone', 'mobile', 'telepon', 'hp', 'whatsapp', 'tel')) return 'phone';
  if (has('nik', 'ktp')) return 'nik';
  if (has('npwp')) return 'npwp';
  if (type === 'date' || has('birth', 'dob', 'tanggal', 'date')) return 'date';
  if (type === 'url' || has('website', 'url')) return 'url';
  if (type === 'number' || has('qty', 'quantity', 'amount', 'jumlah')) return 'number';
  if (type === 'search' || has('search', 'cari')) return 'search';
  if (has('given-name', 'first', 'fname', 'nama depan')) return 'firstName';
  if (has('family-name', 'last', 'lname', 'surname', 'nama belakang')) return 'lastName';
  if (has('username', 'user name', 'login', 'nickname')) return 'username';
  if (has('company', 'organization', 'organisation', 'perusahaan')) return 'company';
  if (has('postal', 'zip', 'kode pos', 'postcode')) return 'postalCode';
  if (has('address-line', 'street', 'address', 'alamat')) return 'street';
  if (has('city', 'kota', 'kabupaten')) return 'city';
  if (has('province', 'state', 'region', 'provinsi')) return 'province';
  if (has('country', 'negara')) return 'country';
  if (has('name', 'nama', 'full')) return 'fullName';
  return attrs.tag === 'textarea' ? 'textarea' : 'text';
}

export function valueFor(kind: FieldKind, p: Person): string {
  switch (kind) {
    case 'email': return p.email;
    case 'password': return p.password;
    case 'firstName': return p.firstName;
    case 'lastName': return p.lastName;
    case 'fullName': return p.fullName;
    case 'username': return p.username;
    case 'phone': return p.phone;
    case 'company': return p.company;
    case 'street': return p.street;
    case 'city': return p.city;
    case 'province': return p.province;
    case 'postalCode': return p.postalCode;
    case 'country': return p.country;
    case 'date': return p.birthDate;
    case 'number': return String(1 + rnd(99));
    case 'url': return 'https://example.test/qa';
    case 'card': return testCard().number;
    case 'cardExpiry': return testCard().expiry;
    case 'cvc': return digits(3);
    case 'nik': return p.nik;
    case 'npwp': return p.npwp;
    case 'otp': return '123456';
    case 'search': return 'qa test';
    case 'textarea': return `QA note ${uniqueTag()}: Lorem ipsum dolor sit amet.`;
    default: return `QA ${uniqueTag()}`;
  }
}

export const QUICK_VALUES: Record<string, { label: string; value: (domain: string) => string }> = {
  email: { label: 'Unique email', value: (d) => person(d).email },
  name: { label: 'Full name', value: () => person().fullName },
  phone: { label: 'Phone (ID)', value: () => person().phone },
  password: { label: 'Strong password', value: () => strongPassword() },
  address: { label: 'Address', value: () => { const p = person(); return `${p.street}, ${p.city}, ${p.province} ${p.postalCode}`; } },
  nik: { label: 'NIK (16 digits, fake)', value: () => person().nik },
  card: { label: 'Test card (Visa 4111…)', value: () => '4111111111111111' },
  uuid: { label: 'UUID', value: () => uuid() },
  lorem: { label: 'Lorem paragraph', value: () => 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.' },
};
