-- Seed data: Coffee shops in Folsom, CA
-- Run in Supabase SQL Editor AFTER running 001-create-tables.sql

-- Independent coffee shops
insert into businesses (name, slug, street_address, city, state, zip, latitude, longitude, category, ownership_tier, story) values
('Kingdom Coffee Roasters', 'kingdom-coffee-roasters', '305 Iron Point Rd', 'Folsom', 'CA', '95630', 38.6489, -121.1461, 'coffee', 'independent', 'Locally owned specialty roaster in Folsom. Roasts in-house, sources direct trade beans.'),
('Chocolate Fish Coffee Roasters', 'chocolate-fish-coffee-roasters', '25055 Blue Ravine Rd Ste 100', 'Folsom', 'CA', '95630', 38.6435, -121.1595, 'coffee', 'independent', 'Sacramento-born roaster with multiple locations. All independently owned and operated.'),
('Coffee Republic', 'coffee-republic', '6610 Folsom Auburn Rd', 'Folsom', 'CA', '95630', 38.6821, -121.1563, 'coffee', 'independent', 'Family-owned breakfast and coffee spot in Folsom. Local favorite since opening.'),
('Big Wave Coffee House', 'big-wave-coffee-house', '189 Blue Ravine Rd Ste 130', 'Folsom', 'CA', '95630', 38.6460, -121.1390, 'coffee', 'independent', 'Locally owned coffeehouse with a laid-back vibe. Community gathering spot.'),
('Sociology Coffee Bar', 'sociology-coffee-bar', '705 Gold Lake Dr Ste 390', 'Folsom', 'CA', '95630', 38.6540, -121.1480, 'coffee', 'independent', 'Independent specialty coffee bar focused on craft espresso and pour-overs.'),
('Late Mouse Coffee', 'late-mouse-coffee', '1001 E Bidwell St Ste 120', 'Folsom', 'CA', '95630', 38.6710, -121.1480, 'coffee', 'independent', 'Small-batch independent coffee shop.'),
('Haraz Coffee House', 'haraz-coffee-house', '2776 E Bidwell St Ste 200', 'Folsom', 'CA', '95630', 38.6590, -121.1200, 'coffee', 'independent', 'Yemeni-inspired coffee house serving traditional and specialty drinks. Family owned.'),
('Qamaria Yemeni Coffee Co', 'qamaria-yemeni-coffee-co', '13405 Folsom Blvd Ste 950', 'Folsom', 'CA', '95630', 38.6367, -121.1680, 'coffee', 'independent', 'Authentic Yemeni coffee roaster. Independent, culturally rooted, locally loved.'),
('World Traveler Coffee Roasters', 'world-traveler-coffee-roasters', '601 E Bidwell St', 'Folsom', 'CA', '95630', 38.6730, -121.1520, 'coffee', 'independent', 'Small-batch roaster inspired by global coffee traditions. Independently owned.'),
('Nicholson''s MusiCafe', 'nicholsons-musicafe', '632 E Bidwell St', 'Folsom', 'CA', '95630', 38.6725, -121.1515, 'coffee', 'independent', 'Coffee shop and live music venue. Family owned, a Folsom cultural staple.'),
('Shady Coffee and Tea', 'shady-coffee-and-tea', '6836 Greenback Ln', 'Folsom', 'CA', '95630', 38.6650, -121.1350, 'coffee', 'independent', 'Independent coffee and tea house with a shaded patio. Locally owned.'),
('Mochinut Folsom', 'mochinut-folsom', '2791 E Bidwell St', 'Folsom', 'CA', '95630', 38.6588, -121.1195, 'coffee', 'independent', 'Korean-inspired mochi donuts and specialty coffee. Independently operated.');

-- Franchise coffee shops (local-franchise tier)
insert into businesses (name, slug, street_address, city, state, zip, latitude, longitude, category, ownership_tier, parent_company, story) values
('Dutch Bros Coffee - Riley St', 'dutch-bros-riley-st', '1000A Riley St', 'Folsom', 'CA', '95630', 38.6505, -121.1410, 'coffee', 'local-franchise', 'Dutch Bros Inc (NYSE: BROS)', 'Publicly traded drive-thru coffee chain. Founded in Oregon, 1992. Individual locations are franchise-operated.'),
('Dutch Bros Coffee - E Bidwell', 'dutch-bros-e-bidwell', '187 E Bidwell St', 'Folsom', 'CA', '95630', 38.6780, -121.1560, 'coffee', 'local-franchise', 'Dutch Bros Inc (NYSE: BROS)', 'Publicly traded drive-thru coffee chain. Franchise-operated location.'),
('The Human Bean', 'the-human-bean-folsom', '115 Stafford Way', 'Folsom', 'CA', '95630', 38.6510, -121.1440, 'coffee', 'local-franchise', 'The Human Bean LLC', 'Oregon-based drive-thru coffee franchise. Individually franchise-owned locations.'),
('Black Rock Coffee Bar', 'black-rock-coffee-bar-folsom', '13370 Folsom Blvd', 'Folsom', 'CA', '95630', 38.6370, -121.1675, 'coffee', 'local-franchise', 'Black Rock Coffee Bar Inc', 'Pacific Northwest chain. Rapid expansion across Western US.');

-- PE-owned coffee (pe-corporate tier)
insert into businesses (name, slug, street_address, city, state, zip, latitude, longitude, category, ownership_tier, parent_company, story) values
('Peet''s Coffee - Iron Point', 'peets-coffee-iron-point', '2575 Iron Point Rd', 'Folsom', 'CA', '95630', 38.6480, -121.1300, 'coffee', 'pe-corporate', 'JAB Holding Company', 'Founded in Berkeley, 1966. Acquired by JAB Holding Company (PE) in 2012. JAB also owns Panera, Krispy Kreme, and Caribou Coffee.'),
('Peet''s Coffee - E Bidwell', 'peets-coffee-e-bidwell', '1550 E Bidwell St', 'Folsom', 'CA', '95630', 38.6670, -121.1400, 'coffee', 'pe-corporate', 'JAB Holding Company', 'Part of JAB Holding Company portfolio. Once independent, now PE-owned since 2012.');

-- Corporate coffee (pe-corporate tier)
insert into businesses (name, slug, street_address, city, state, zip, latitude, longitude, category, ownership_tier, parent_company, story) values
('Starbucks - Iron Point', 'starbucks-iron-point', '2580 Iron Point Rd', 'Folsom', 'CA', '95630', 38.6478, -121.1295, 'coffee', 'pe-corporate', 'Starbucks Corp (NASDAQ: SBUX)', 'Publicly traded multinational. Founded Seattle 1971. Corporate-owned and operated.'),
('Starbucks - E Bidwell', 'starbucks-e-bidwell', '720 E Bidwell St', 'Folsom', 'CA', '95630', 38.6720, -121.1510, 'coffee', 'pe-corporate', 'Starbucks Corp (NASDAQ: SBUX)', 'Publicly traded multinational. Corporate-owned and operated.'),
('Starbucks - Folsom Blvd', 'starbucks-folsom-blvd', '2050 Folsom Blvd', 'Folsom', 'CA', '95630', 38.6390, -121.1750, 'coffee', 'pe-corporate', 'Starbucks Corp (NASDAQ: SBUX)', 'Publicly traded multinational. Corporate-owned and operated.'),
('Starbucks - Blue Ravine', 'starbucks-blue-ravine', '200 Blue Ravine Rd', 'Folsom', 'CA', '95630', 38.6455, -121.1385, 'coffee', 'pe-corporate', 'Starbucks Corp (NASDAQ: SBUX)', 'Publicly traded multinational. Corporate-owned and operated.');

-- Total: 12 independent, 4 local-franchise, 6 pe-corporate = 22 businesses
