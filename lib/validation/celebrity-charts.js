// =========================================
// CELEBRITY VALIDATION DATASET
// =========================================
//
// Public birth data + documented major life events for charts where
// both the timing and the event domain are well-known. Used by the
// validation runner to measure rule-engine accuracy.
//
// SOURCES for birth data:
//   - astrodatabank (Lois Rodden's database, peer-reviewed)
//   - jyotish.app, astro.com, scientificvedic.com
//   - Public statements / interviews / Wikipedia where rated A/AA only
//
// Rodden Rating system (data quality):
//   AA = from birth certificate / hospital record
//   A  = personally given by subject or family
//   B  = biography or autobiography
//   C  = caution — date OK, time uncertain
//   DD = dirty data, multiple conflicting versions (avoid)
//
// We deliberately use AA/A only for time-sensitive rules. For B-rated
// charts we test only ±1 year windows on major events to absorb the
// time-of-birth uncertainty.
//
// Each event:
//   date         ISO date the event publicly happened
//   domain       which rule domain SHOULD have fired for this event
//   description  human-readable note for the test report
//   minIntensity (optional) drop matches below this threshold

module.exports = [
  // ── AA RATED (birth certificates) ──────────────────────────

  {
    name: 'Sachin Tendulkar',
    rodden: 'AA',
    birth: {
      date: '1973-04-24',
      time: '17:35',
      timezone: 'Asia/Kolkata',
      lat: 19.0760, lon: 72.8777, // Mumbai
    },
    events: [
      { date: '1989-11-15', domain: 'career', description: 'Test cricket debut at age 16' },
      { date: '1995-05-24', domain: 'marriage', description: 'Married Anjali' },
      { date: '1997-04-04', domain: 'children', description: 'Daughter Sara born' },
      { date: '2011-04-02', domain: 'career', description: 'World Cup win (career pinnacle)' },
      { date: '2013-11-16', domain: 'career', description: 'Retirement from international cricket' },
    ],
  },

  {
    name: 'Aishwarya Rai',
    rodden: 'A',
    birth: {
      date: '1973-11-01',
      time: '04:51',
      timezone: 'Asia/Kolkata',
      lat: 12.9141, lon: 74.8560, // Mangalore
    },
    events: [
      { date: '1994-11-19', domain: 'career', description: 'Miss World crowning' },
      { date: '2007-04-20', domain: 'marriage', description: 'Married Abhishek Bachchan' },
      { date: '2011-11-16', domain: 'children', description: 'Daughter Aaradhya born' },
    ],
  },

  {
    name: 'Virat Kohli',
    rodden: 'A',
    birth: {
      date: '1988-11-05',
      time: '03:37',
      timezone: 'Asia/Kolkata',
      lat: 28.6139, lon: 77.2090, // Delhi
    },
    events: [
      { date: '2008-08-18', domain: 'career', description: 'ODI debut' },
      { date: '2014-12-12', domain: 'career', description: 'Test captaincy' },
      { date: '2017-12-11', domain: 'marriage', description: 'Married Anushka Sharma' },
      { date: '2021-01-11', domain: 'children', description: 'Daughter Vamika born' },
    ],
  },

  {
    name: 'Sania Mirza',
    rodden: 'A',
    birth: {
      date: '1986-11-15',
      time: '16:00',
      timezone: 'Asia/Kolkata',
      lat: 19.0760, lon: 72.8777, // Mumbai (born during family travel)
    },
    events: [
      { date: '2003-07-01', domain: 'career', description: 'Turned pro at 16' },
      { date: '2010-04-12', domain: 'marriage', description: 'Married Shoaib Malik' },
      { date: '2018-10-30', domain: 'children', description: 'Son Izhaan born' },
    ],
  },

  {
    name: 'Priyanka Chopra',
    rodden: 'A',
    birth: {
      date: '1982-07-18',
      time: '06:00',
      timezone: 'Asia/Kolkata',
      lat: 22.8046, lon: 86.2029, // Jamshedpur
    },
    events: [
      { date: '2000-11-30', domain: 'career', description: 'Miss World crowning' },
      { date: '2015-09-24', domain: 'foreign', description: 'Quantico US TV debut (foreign career)' },
      { date: '2018-12-01', domain: 'marriage', description: 'Married Nick Jonas in India' },
      { date: '2022-01-22', domain: 'children', description: 'Daughter Malti born via surrogacy' },
    ],
  },

  // ── B RATED (biography sources, mostly reliable) ─────────────

  {
    name: 'Narendra Modi',
    rodden: 'B',
    birth: {
      date: '1950-09-17',
      time: '11:00',
      timezone: 'Asia/Kolkata',
      lat: 23.7892, lon: 72.6411, // Vadnagar, Gujarat
    },
    events: [
      { date: '2001-10-07', domain: 'career', description: 'Sworn in as Gujarat CM' },
      { date: '2014-05-26', domain: 'career', description: 'Sworn in as Prime Minister' },
      { date: '2019-05-30', domain: 'career', description: 'Re-elected PM' },
    ],
  },

  {
    name: 'Amitabh Bachchan',
    rodden: 'AA',
    birth: {
      date: '1942-10-11',
      time: '16:00',
      timezone: 'Asia/Kolkata',
      lat: 25.4358, lon: 81.8463, // Allahabad
    },
    events: [
      { date: '1973-06-02', domain: 'marriage', description: 'Married Jaya Bhaduri' },
      { date: '1975-08-15', domain: 'career', description: 'Sholay release — career-defining film' },
      { date: '1982-07-26', domain: 'health', description: 'Near-fatal injury on Coolie set' },
      { date: '2000-07-03', domain: 'career', description: 'KBC debut — career resurrection' },
    ],
  },

  {
    name: 'A.R. Rahman',
    rodden: 'A',
    birth: {
      date: '1967-01-06',
      time: '04:10',
      timezone: 'Asia/Kolkata',
      lat: 13.0827, lon: 80.2707, // Chennai
    },
    events: [
      { date: '1992-08-15', domain: 'career', description: 'Roja release — breakthrough' },
      { date: '1995-03-12', domain: 'marriage', description: 'Married Saira Banu' },
      { date: '2009-02-22', domain: 'career', description: 'Two Academy Awards (Slumdog Millionaire)' },
    ],
  },

  {
    name: 'Mukesh Ambani',
    rodden: 'B',
    birth: {
      date: '1957-04-19',
      time: '11:25',
      timezone: 'Asia/Aden',
      lat: 12.7855, lon: 45.0187, // Aden, Yemen
    },
    events: [
      { date: '1985-03-08', domain: 'marriage', description: 'Married Nita Dalal' },
      { date: '2002-07-06', domain: 'wealth', description: 'Took over Reliance (father\'s death)' },
      { date: '2008-01-01', domain: 'wealth', description: 'Became world\'s richest Indian' },
    ],
  },

  {
    name: 'Lata Mangeshkar',
    rodden: 'A',
    birth: {
      date: '1929-09-28',
      time: '21:30',
      timezone: 'Asia/Kolkata',
      lat: 22.7196, lon: 75.8577, // Indore
    },
    events: [
      { date: '1958-01-01', domain: 'career', description: 'National Film Award (career peak)' },
      { date: '2001-03-27', domain: 'career', description: 'Bharat Ratna' },
      { date: '2022-02-06', domain: 'health', description: 'Death from COVID-19 complications' },
    ],
  },

  // ── INTERNATIONAL (for non-Indian relevance) ─────────────────

  {
    name: 'Steve Jobs',
    rodden: 'A',
    birth: {
      date: '1955-02-24',
      time: '19:15',
      timezone: 'America/Los_Angeles',
      lat: 37.7749, lon: -122.4194, // San Francisco
    },
    events: [
      { date: '1976-04-01', domain: 'career', description: 'Co-founded Apple' },
      { date: '1985-09-17', domain: 'career', description: 'Forced out of Apple' },
      { date: '1991-03-18', domain: 'marriage', description: 'Married Laurene Powell' },
      { date: '1997-09-16', domain: 'career', description: 'Returned to Apple as CEO' },
      { date: '2003-10-01', domain: 'health', description: 'Diagnosed with pancreatic cancer' },
      { date: '2011-10-05', domain: 'health', description: 'Death' },
    ],
  },

  {
    name: 'Elon Musk',
    rodden: 'B',
    birth: {
      date: '1971-06-28',
      time: '07:30',
      timezone: 'Africa/Johannesburg',
      lat: -25.7479, lon: 28.2293, // Pretoria
    },
    events: [
      { date: '2000-01-08', domain: 'marriage', description: 'First marriage (Justine Wilson)' },
      { date: '2002-06-01', domain: 'career', description: 'Founded SpaceX' },
      { date: '2003-07-01', domain: 'career', description: 'Joined Tesla' },
      { date: '2022-10-27', domain: 'career', description: 'Acquired Twitter' },
    ],
  },

  // ── EXPANSION TO 30 CHARTS ──────────────────────────────────
  // Added in week-19/20 follow-up. Mix of AA/A (preferred) and B
  // sources, biased toward Indian icons + well-documented events.

  {
    name: 'Indira Gandhi',
    rodden: 'AA',
    birth: {
      date: '1917-11-19',
      time: '23:11',
      timezone: 'Asia/Kolkata',
      lat: 25.4358, lon: 81.8463, // Allahabad
    },
    events: [
      { date: '1942-03-26', domain: 'marriage', description: 'Married Feroze Gandhi' },
      { date: '1966-01-24', domain: 'career', description: 'Sworn in as 3rd PM of India' },
      { date: '1975-06-25', domain: 'career', description: 'Declared Emergency' },
      { date: '1984-10-31', domain: 'health', description: 'Assassination' },
    ],
  },

  {
    name: 'Rajiv Gandhi',
    rodden: 'A',
    birth: {
      date: '1944-08-20',
      time: '07:11',
      timezone: 'Asia/Kolkata',
      lat: 18.9750, lon: 72.8258, // Bombay
    },
    events: [
      { date: '1968-02-25', domain: 'marriage', description: 'Married Sonia Maino' },
      { date: '1984-10-31', domain: 'career', description: 'Sworn in as PM (after Indira death)' },
      { date: '1991-05-21', domain: 'health', description: 'Assassination (LTTE bomb)' },
    ],
  },

  {
    name: 'Mahatma Gandhi',
    rodden: 'B',
    birth: {
      date: '1869-10-02',
      time: '07:11',
      timezone: 'Asia/Kolkata',
      lat: 21.6417, lon: 69.6293, // Porbandar
    },
    events: [
      { date: '1893-05-23', domain: 'foreign', description: 'Arrived in South Africa (career-defining)' },
      { date: '1915-01-09', domain: 'foreign', description: 'Returned to India from South Africa' },
      { date: '1930-03-12', domain: 'career', description: 'Salt March / Dandi (movement peak)' },
      { date: '1948-01-30', domain: 'health', description: 'Assassination' },
    ],
  },

  {
    name: 'A.B. Vajpayee',
    rodden: 'B',
    birth: {
      date: '1924-12-25',
      time: '05:00',
      timezone: 'Asia/Kolkata',
      lat: 26.2183, lon: 78.1828, // Gwalior
    },
    events: [
      { date: '1996-05-16', domain: 'career', description: 'PM (13-day government)' },
      { date: '1998-03-19', domain: 'career', description: 'PM (13-month government)' },
      { date: '1999-10-13', domain: 'career', description: 'PM (full term)' },
    ],
  },

  {
    name: 'M.S. Dhoni',
    rodden: 'B',
    birth: {
      date: '1981-07-07',
      time: '10:00',
      timezone: 'Asia/Kolkata',
      lat: 23.3441, lon: 85.3096, // Ranchi
    },
    events: [
      { date: '2004-12-23', domain: 'career', description: 'ODI debut' },
      { date: '2007-09-02', domain: 'career', description: 'Made India captain (T20 World Cup win shortly after)' },
      { date: '2010-07-04', domain: 'marriage', description: 'Married Sakshi Singh Rawat' },
      { date: '2011-04-02', domain: 'career', description: 'Won ICC Cricket World Cup' },
      { date: '2015-02-06', domain: 'children', description: 'Daughter Ziva born' },
      { date: '2020-08-15', domain: 'career', description: 'Retirement from international cricket' },
    ],
  },

  {
    name: 'Aamir Khan',
    rodden: 'A',
    birth: {
      date: '1965-03-14',
      time: '09:30',
      timezone: 'Asia/Kolkata',
      lat: 19.0760, lon: 72.8777, // Mumbai
    },
    events: [
      { date: '1986-04-18', domain: 'marriage', description: 'Married Reena Dutta' },
      { date: '1988-04-29', domain: 'career', description: 'QSQT release — career breakthrough' },
      { date: '2002-12-11', domain: 'marriage', description: 'Divorce from Reena Dutta' },
      { date: '2005-12-28', domain: 'marriage', description: 'Married Kiran Rao' },
      { date: '2016-12-23', domain: 'career', description: 'Dangal release — biggest career hit' },
    ],
  },

  {
    name: 'Salman Khan',
    rodden: 'B',
    birth: {
      date: '1965-12-27',
      time: '16:30',
      timezone: 'Asia/Kolkata',
      lat: 22.7196, lon: 75.8577, // Indore
    },
    events: [
      { date: '1989-12-29', domain: 'career', description: 'Maine Pyar Kiya — breakout role' },
      { date: '1998-09-28', domain: 'health', description: 'Hit-and-run case incident' },
      { date: '2009-12-18', domain: 'career', description: 'Wanted — career resurrection' },
    ],
  },

  {
    name: 'Madhuri Dixit',
    rodden: 'A',
    birth: {
      date: '1967-05-15',
      time: '05:00',
      timezone: 'Asia/Kolkata',
      lat: 19.0760, lon: 72.8777, // Mumbai
    },
    events: [
      { date: '1988-11-04', domain: 'career', description: 'Tezaab release — career-defining' },
      { date: '1999-10-17', domain: 'marriage', description: 'Married Dr. Shriram Nene' },
      { date: '2003-03-17', domain: 'children', description: 'Son Arin born' },
    ],
  },

  {
    name: 'Akshay Kumar',
    rodden: 'A',
    birth: {
      date: '1967-09-09',
      time: '12:50',
      timezone: 'Asia/Kolkata',
      lat: 31.6340, lon: 74.8723, // Amritsar
    },
    events: [
      { date: '1991-04-12', domain: 'career', description: 'Saugandh release — debut' },
      { date: '2001-01-17', domain: 'marriage', description: 'Married Twinkle Khanna' },
      { date: '2002-09-15', domain: 'children', description: 'Son Aarav born' },
      { date: '2017-09-15', domain: 'career', description: 'National Film Award for Best Actor (Rustom)' },
    ],
  },

  {
    name: 'Sridevi',
    rodden: 'A',
    birth: {
      date: '1963-08-13',
      time: '07:15',
      timezone: 'Asia/Kolkata',
      lat: 9.4533, lon: 77.7869, // Sivakasi
    },
    events: [
      { date: '1983-09-15', domain: 'career', description: 'Himmatwala — Bollywood breakthrough' },
      { date: '1996-06-02', domain: 'marriage', description: 'Married Boney Kapoor' },
      { date: '1996-08-20', domain: 'children', description: 'Daughter Janhvi born' },
      { date: '2018-02-24', domain: 'health', description: 'Sudden death (drowning in Dubai)' },
    ],
  },

  {
    name: 'Asha Bhosle',
    rodden: 'B',
    birth: {
      date: '1933-09-08',
      time: '16:30',
      timezone: 'Asia/Kolkata',
      lat: 16.8524, lon: 74.5815, // Sangli
    },
    events: [
      { date: '1949-03-04', domain: 'marriage', description: 'Married Ganpatrao Bhosle' },
      { date: '1980-04-25', domain: 'marriage', description: 'Married R.D. Burman' },
      { date: '2008-01-26', domain: 'career', description: 'Padma Vibhushan' },
    ],
  },

  {
    name: 'Rekha',
    rodden: 'B',
    birth: {
      date: '1954-10-10',
      time: '12:30',
      timezone: 'Asia/Kolkata',
      lat: 13.0827, lon: 80.2707, // Madras
    },
    events: [
      { date: '1976-07-30', domain: 'career', description: 'Do Anjaane — career upturn' },
      { date: '1981-08-14', domain: 'career', description: 'Umrao Jaan release — career peak' },
      { date: '1990-03-04', domain: 'marriage', description: 'Married Mukesh Aggarwal' },
    ],
  },

  // ── INTERNATIONAL EXPANSION ──────────────────────────────────

  {
    name: 'Bill Gates',
    rodden: 'AA',
    birth: {
      date: '1955-10-28',
      time: '22:00',
      timezone: 'America/Los_Angeles',
      lat: 47.6062, lon: -122.3321, // Seattle
    },
    events: [
      { date: '1975-04-04', domain: 'career', description: 'Co-founded Microsoft' },
      { date: '1994-01-01', domain: 'marriage', description: 'Married Melinda French' },
      { date: '2000-01-13', domain: 'career', description: 'Stepped down as CEO' },
      { date: '2008-06-27', domain: 'career', description: 'Full-time transition to philanthropy' },
      { date: '2021-05-03', domain: 'marriage', description: 'Divorce from Melinda announced' },
    ],
  },

  {
    name: 'Oprah Winfrey',
    rodden: 'A',
    birth: {
      date: '1954-01-29',
      time: '04:30',
      timezone: 'America/Chicago',
      lat: 33.0570, lon: -89.5870, // Kosciusko, MS
    },
    events: [
      { date: '1986-09-08', domain: 'career', description: 'Oprah Winfrey Show goes national' },
      { date: '2003-09-22', domain: 'wealth', description: 'First African-American female billionaire' },
      { date: '2011-05-25', domain: 'career', description: 'End of Oprah Winfrey Show' },
    ],
  },

  {
    name: 'Leonardo DiCaprio',
    rodden: 'A',
    birth: {
      date: '1974-11-11',
      time: '02:47',
      timezone: 'America/Los_Angeles',
      lat: 34.0522, lon: -118.2437, // Los Angeles
    },
    events: [
      { date: '1997-12-19', domain: 'career', description: 'Titanic release — global stardom' },
      { date: '2016-02-28', domain: 'career', description: 'Won Best Actor Oscar (The Revenant)' },
    ],
  },

  {
    name: 'Mark Zuckerberg',
    rodden: 'B',
    birth: {
      date: '1984-05-14',
      time: '14:30',
      timezone: 'America/New_York',
      lat: 41.0340, lon: -73.7629, // White Plains, NY
    },
    events: [
      { date: '2004-02-04', domain: 'career', description: 'Launched Facebook' },
      { date: '2012-05-18', domain: 'wealth', description: 'Facebook IPO' },
      { date: '2012-05-19', domain: 'marriage', description: 'Married Priscilla Chan' },
      { date: '2015-12-01', domain: 'children', description: 'First daughter Max born' },
    ],
  },

  {
    name: 'Roger Federer',
    rodden: 'B',
    birth: {
      date: '1981-08-08',
      time: '08:40',
      timezone: 'Europe/Zurich',
      lat: 47.5596, lon: 7.5886, // Basel
    },
    events: [
      { date: '2003-07-06', domain: 'career', description: 'First Wimbledon title (career breakthrough)' },
      { date: '2009-04-11', domain: 'marriage', description: 'Married Mirka Vavrinec' },
      { date: '2022-09-23', domain: 'career', description: 'Retirement from professional tennis' },
    ],
  },

  {
    name: 'Cristiano Ronaldo',
    rodden: 'B',
    birth: {
      date: '1985-02-05',
      time: '05:25',
      timezone: 'Atlantic/Madeira',
      lat: 32.6669, lon: -16.9241, // Funchal
    },
    events: [
      { date: '2003-08-12', domain: 'career', description: 'Signed with Manchester United (career breakthrough)' },
      { date: '2008-12-02', domain: 'career', description: 'First Ballon d\'Or' },
      { date: '2010-06-17', domain: 'children', description: 'First child Cristiano Jr. born' },
    ],
  },
];
