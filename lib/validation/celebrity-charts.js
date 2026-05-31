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
];
