-- The Certificate design page is gone. Its power now means "See certificate": seeing what a certificate looks like (its
-- page and print preview). Without it a person can still print certificates (e.g. district desk staff).
update public.permissions
   set description_en = 'See certificate (its page and print preview)',
       description_so = 'Arag shahaadada (boggeeda iyo horudhac daabacaadda)'
 where key = 'certificates.design';
