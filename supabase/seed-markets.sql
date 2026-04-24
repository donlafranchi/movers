-- seed-markets.sql
-- Sacramento-area farmers markets + mock vendors for b1 launch

-- Markets
insert into markets (name, slug, city, state, latitude, longitude, schedule_days, schedule_start_time, schedule_end_time, description) values
  ('Folsom Farmers Market', 'folsom-farmers-market', 'Folsom', 'CA', 38.67794, -121.17607, array['sat'], '08:00', '13:00', 'Year-round Saturday market in historic downtown Folsom.'),
  ('Sacramento Central Farmers Market', 'sacramento-central-farmers-market', 'Sacramento', 'CA', 38.57666, -121.48720, array['sun'], '08:00', '12:00', 'Under the W/X freeway, the largest certified farmers market in the region.'),
  ('Roseville Farmers Market', 'roseville-farmers-market', 'Roseville', 'CA', 38.75215, -121.28801, array['sat'], '08:00', '12:00', 'Saturday market at the Fountains shopping center.')
on conflict (slug) do nothing;

-- Mock vendors (using businesses table)
insert into businesses (name, slug, street_address, city, state, zip, latitude, longitude, category, ownership_tier, story, tagline, cover_photo_url, website_url, instagram_handle, is_featured, featured_at) values
  ('Honeybee Hollow', 'honeybee-hollow', '1 Sutter St', 'Folsom', 'CA', '95630', 38.67794, -121.17607, 'honey-jams', 'independent', 'Small-batch wildflower honey from hives in the Sierra foothills.', 'Raw wildflower honey and seasonal jams', null, 'https://honeybeehollow.example', 'honeybeehollow', true, now()),
  ('Stoneground Bakery', 'stoneground-bakery', '700 Sutter St', 'Folsom', 'CA', '95630', 38.67800, -121.17610, 'bread', 'independent', 'Sourdough and pastries milled from California-grown heritage grains.', 'Sourdough, pastries, and pies', null, null, 'stonegroundbakery', false, null),
  ('Sutter Creek Soapworks', 'sutter-creek-soapworks', '200 Main St', 'Sutter Creek', 'CA', '95685', 38.39260, -120.80191, 'soap-body', 'independent', 'Cold-process soaps made with olive oil and goat milk.', 'Handmade soaps and body care', null, null, 'suttercreeksoap', false, null),
  ('Valley Glow Candles', 'valley-glow-candles', '400 K St', 'Sacramento', 'CA', '95814', 38.57666, -121.48720, 'candles', 'independent', 'Hand-poured soy candles in small batches.', 'Hand-poured soy candles', null, null, 'valleyglow', false, null),
  ('Good Earth Greens', 'good-earth-greens', '1600 Pine Grove Rd', 'Roseville', 'CA', '95747', 38.75215, -121.28801, 'produce', 'independent', 'Family farm, fourth generation, no-spray greens and vegetables.', 'Seasonal greens and heirloom vegetables', null, null, 'goodearthgreens', false, null),
  ('Shady Oak Pottery', 'shady-oak-pottery', '50 Vernon St', 'Roseville', 'CA', '95678', 38.75230, -121.28820, 'crafts', 'independent', 'Hand-thrown stoneware for every day.', 'Hand-thrown stoneware', null, null, 'shadyoakpottery', false, null),
  ('Wild Acre Flowers', 'wild-acre-flowers', '1000 R St', 'Sacramento', 'CA', '95811', 38.57720, -121.48800, 'plants-flowers', 'independent', 'Field-grown flowers and native plants.', 'Seasonal bouquets and native plants', null, null, 'wildacre', false, null),
  ('Ferndale Farm Eggs', 'ferndale-farm-eggs', '2000 J St', 'Sacramento', 'CA', '95816', 38.57500, -121.48500, 'meat-eggs', 'independent', 'Pasture-raised eggs from happy hens.', 'Pasture-raised eggs', null, null, 'ferndalefarm', false, null)
on conflict (slug) do nothing;

-- Vendor categories
insert into vendor_categories (vendor_id, category_slug, is_primary)
select b.id, b.category, true from businesses b
where b.slug in ('honeybee-hollow','stoneground-bakery','sutter-creek-soapworks','valley-glow-candles','good-earth-greens','shady-oak-pottery','wild-acre-flowers','ferndale-farm-eggs')
on conflict (vendor_id, category_slug) do nothing;

-- Add some secondary categories
insert into vendor_categories (vendor_id, category_slug, is_primary)
select b.id, 'honey-jams', false from businesses b where b.slug = 'stoneground-bakery'
on conflict do nothing;

insert into vendor_categories (vendor_id, category_slug, is_primary)
select b.id, 'plants-flowers', false from businesses b where b.slug = 'good-earth-greens'
on conflict do nothing;

-- Market-vendor links
-- Folsom: Honeybee Hollow, Stoneground Bakery
insert into market_vendors (market_id, vendor_id)
select m.id, b.id from markets m, businesses b
where m.slug = 'folsom-farmers-market' and b.slug in ('honeybee-hollow','stoneground-bakery','sutter-creek-soapworks')
on conflict do nothing;

-- Sacramento Central: Valley Glow, Wild Acre, Ferndale, Good Earth
insert into market_vendors (market_id, vendor_id)
select m.id, b.id from markets m, businesses b
where m.slug = 'sacramento-central-farmers-market' and b.slug in ('valley-glow-candles','wild-acre-flowers','ferndale-farm-eggs','good-earth-greens','honeybee-hollow')
on conflict do nothing;

-- Roseville: Good Earth, Shady Oak, Stoneground
insert into market_vendors (market_id, vendor_id)
select m.id, b.id from markets m, businesses b
where m.slug = 'roseville-farmers-market' and b.slug in ('good-earth-greens','shady-oak-pottery','stoneground-bakery')
on conflict do nothing;
