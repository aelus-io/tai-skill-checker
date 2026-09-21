CREATE FUNCTION reject_assessment_version_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'published assessment versions are immutable';
END;
$$;--> statement-breakpoint

CREATE FUNCTION reject_published_content_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.assessment_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'published assessment content is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER assessment_versions_immutable
BEFORE UPDATE OR DELETE ON assessment_versions
FOR EACH ROW EXECUTE FUNCTION reject_assessment_version_change();--> statement-breakpoint

CREATE TRIGGER published_scenarios_immutable
BEFORE UPDATE OR DELETE ON scenarios
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();--> statement-breakpoint

CREATE TRIGGER published_competencies_immutable
BEFORE UPDATE OR DELETE ON competencies
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();--> statement-breakpoint

CREATE TRIGGER published_rubrics_immutable
BEFORE UPDATE OR DELETE ON rubrics
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();--> statement-breakpoint

CREATE TRIGGER published_scenario_competencies_immutable
BEFORE UPDATE OR DELETE ON scenario_competencies
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();--> statement-breakpoint

CREATE TRIGGER published_resources_immutable
BEFORE UPDATE OR DELETE ON resources
FOR EACH ROW EXECUTE FUNCTION reject_published_content_change();
