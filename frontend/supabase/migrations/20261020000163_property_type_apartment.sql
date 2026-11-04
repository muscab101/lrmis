-- Apartment as a property type, priced like a storey building until changed on Valuation → Property grades.
insert into public.property_grades (code, name_so, name_en, amount, active, sort)
values ('apartment', 'Abaartamaan', 'Apartment', 0.40, true, 0)
on conflict (code) do update set name_so = excluded.name_so, name_en = excluded.name_en, active = true;
