-- Saving a district's boundary (Locations → boundary) failed for staff: the trigger that puts the district's name in
-- the middle of its largest part calls private.district_label_point, which only the database owner could run.
-- It only works out a point from a shape (no data is read), so anyone signed in may run it.
grant execute on function private.district_label_point(extensions.geometry) to authenticated;
