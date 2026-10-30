-- A buyer can support more than one grade on a night, so store a list.
alter table order_items
  alter column grade_supported type text[] using array[grade_supported];
alter table order_items rename column grade_supported to grades_supported;
alter table order_items add constraint order_items_grades_supported_check check (cardinality(grades_supported) > 0);

alter table comps
  alter column grade_supported type text[] using array[grade_supported];
alter table comps rename column grade_supported to grades_supported;
alter table comps add constraint comps_grades_supported_check check (cardinality(grades_supported) > 0);
