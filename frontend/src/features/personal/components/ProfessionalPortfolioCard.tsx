import { useMemo, useState } from "react";
import {
  Award,
  Briefcase,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Globe,
  Loader2,
  Phone,
  Save,
  Sparkles,
  User,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ProfilePortfolioTemplate } from "@/components/templates/ProfilePortfolioTemplate.tsx";
import { getCurrentSession } from "../../../lib/auth/session.ts";
import { useAsyncAction } from "../../../hooks/useAsyncAction.ts";
import {
  getProfessionalByWorkspace,
  upsertProfessionalProfile,
  type ProfessionalRow,
} from "../../../lib/repositories/professionals.ts";

const DISCIPLINES = [
  "Land Surveying",
  "Geomatics",
  "Engineering Surveying",
  "Geodesy",
  "Hydrographic Surveying",
  "Mine Surveying",
];

const AVAILABILITY_OPTIONS = ["Available", "Busy", "Available Soon"];
const RATE_PER_OPTIONS = ["hour", "day", "project"];
const CURRENCIES = ["USD", "ZAR", "EUR", "GBP"];

interface ProfessionalPortfolioCardProps {
  workspaceId: string;
  userName?: string;
}

function parseNumber(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function arrayToText(value: string[] | null | undefined): string {
  return (value ?? []).join(", ");
}

function textToArray(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProfessionalPortfolioCard({
  workspaceId,
  userName,
}: ProfessionalPortfolioCardProps) {
  const [profile, setProfile] = useState<ProfessionalRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [discipline, setDiscipline] = useState("Land Surveying");
  const [experience, setExperience] = useState("");
  const [location, setLocation] = useState("");
  const [rate, setRate] = useState("");
  const [ratePer, setRatePer] = useState("hour");
  const [currency, setCurrency] = useState("USD");
  const [availability, setAvailability] = useState("Available");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [certifications, setCertifications] = useState("");
  const [isAvailable, setIsAvailable] = useState(false);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const [data, session] = await Promise.all([
        getProfessionalByWorkspace(workspaceId),
        getCurrentSession(),
      ]);
      setProfile(data);
      setSessionEmail(session?.user?.email ?? null);
      if (data) {
        setName(data.name);
        setTitle(data.title);
        setDiscipline(data.discipline);
        setExperience(data.experience);
        setLocation(data.location);
        setRate(String(data.rate ?? ""));
        setRatePer(data.rate_per);
        setCurrency(data.currency);
        setAvailability(data.availability);
        setBio(data.bio ?? "");
        setSkills(arrayToText(data.skills));
        setCertifications(arrayToText(data.certifications));
        setIsAvailable(data.availability === "Available");
      } else {
        setName(userName ?? "");
      }
    } catch (err: unknown) {
      setNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load profile.",
      });
    } finally {
      setLoading(false);
    }
  };

  useAsyncAction(loadProfile, [workspaceId, userName]);

  const handleSave = async () => {
    if (!name.trim() || !title.trim() || !discipline.trim()) {
      setNotice({ type: "error", message: "Name, title and discipline are required." });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      const saved = await upsertProfessionalProfile(workspaceId, {
        name: name.trim(),
        title: title.trim(),
        discipline,
        experience: experience.trim(),
        location: location.trim(),
        rate: parseNumber(rate),
        rate_per: ratePer,
        currency,
        availability: isAvailable ? "Available" : availability,
        bio: bio.trim() || null,
        skills: textToArray(skills),
        certifications: textToArray(certifications),
      });
      setProfile(saved);
      setNotice({ type: "success", message: "Profile published and visible globally." });
    } catch (err: unknown) {
      setNotice({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  const skillTags = useMemo(() => textToArray(skills), [skills]);
  const certTags = useMemo(() => textToArray(certifications), [certifications]);

  const completeness = useMemo(() => {
    const fields = [
      name.trim(),
      title.trim(),
      discipline.trim(),
      experience.trim(),
      location.trim(),
      Number(rate) > 0,
      bio.trim().length >= 30,
      skillTags.length > 0,
      certTags.length > 0,
    ];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }, [name, title, discipline, experience, location, rate, bio, skillTags.length, certTags.length]);

  const profilePreviewData = {
    name,
    title,
    discipline,
    experience,
    location,
    rate: Number(rate),
    ratePer,
    currency,
    availability,
    isAvailable,
    bio,
    skills: skillTags,
    certifications: certTags,
    email: sessionEmail,
    rating: profile?.rating ?? null,
    reviews: profile?.reviews ?? null,
    fallbackInitials: userName,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Briefcase size={18} />
              Professional Portfolio
            </CardTitle>
            <CardDescription>
              Publish your surveyor profile so businesses can find and hire you.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {profile?.is_global && (
              <Badge variant="outline" className="gap-1">
                <Globe size={12} /> Global
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsOpen((v) => !v)}
              aria-label={isOpen ? "Collapse portfolio" : "Expand portfolio"}
            >
              {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-6 pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin mr-2" /> Loading profile...
            </div>
          ) : (
            <>
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="available-for-hire" className="text-sm font-medium">
                      Available for hire
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Show your profile in the Hire directory.
                    </p>
                  </div>
                  <Switch
                    id="available-for-hire"
                    checked={isAvailable}
                    onCheckedChange={setIsAvailable}
                  />
                </div>
              </div>

              <ProfilePortfolioTemplate profile={profilePreviewData} />

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Profile completeness</span>
                  <span className="text-muted-foreground">{completeness}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${completeness}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {completeness < 40
                    ? "Add more details to stand out to potential clients."
                    : completeness < 80
                    ? "Good start. A rich bio and contact info help you get hired."
                    : "Great portfolio — you're ready to be discovered."}
                </p>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <User size={16} className="text-primary" /> Basic Information
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-name">Full name</Label>
                    <Input
                      id="pp-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. John Doe"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-title">Professional title</Label>
                    <Input
                      id="pp-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Principal Surveyor"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-discipline">Discipline</Label>
                    <Select value={discipline} onValueChange={setDiscipline}>
                      <SelectTrigger id="pp-discipline">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISCIPLINES.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-experience">Experience</Label>
                    <Input
                      id="pp-experience"
                      value={experience}
                      onChange={(e) => setExperience(e.target.value)}
                      placeholder="e.g. 12 years"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="pp-location">Location</Label>
                    <Input
                      id="pp-location"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Harare, Zimbabwe"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <DollarSign size={16} className="text-primary" /> Availability & Rate
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-availability">Availability status</Label>
                    <Select value={availability} onValueChange={setAvailability}>
                      <SelectTrigger id="pp-availability">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AVAILABILITY_OPTIONS.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-rate">Rate</Label>
                    <Input
                      id="pp-rate"
                      type="number"
                      min={0}
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pp-rate-per">Per</Label>
                      <Select value={ratePer} onValueChange={setRatePer}>
                        <SelectTrigger id="pp-rate-per">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RATE_PER_OPTIONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pp-currency">Currency</Label>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger id="pp-currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles size={16} className="text-primary" /> About You
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-bio">Bio</Label>
                  <Textarea
                    id="pp-bio"
                    rows={4}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Short summary of your surveying background, strengths, and the types of projects you enjoy..."
                  />
                  <p className="text-xs text-muted-foreground">
                    A rich bio (30+ characters) improves your search ranking.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Wrench size={16} className="text-primary" /> Skills & Certifications
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-skills">Skills</Label>
                    <Textarea
                      id="pp-skills"
                      rows={3}
                      value={skills}
                      onChange={(e) => setSkills(e.target.value)}
                      placeholder="CAD, Total Station, GNSS, Drone surveying, Least Squares..."
                    />
                    <p className="text-xs text-muted-foreground">Separate skills with commas.</p>
                    {skillTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {skillTags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-certs">Certifications</Label>
                    <Textarea
                      id="pp-certs"
                      rows={3}
                      value={certifications}
                      onChange={(e) => setCertifications(e.target.value)}
                      placeholder="PLS, RICS, CST, SACQSP, PrEng..."
                    />
                    <p className="text-xs text-muted-foreground">Separate certifications with commas.</p>
                    {certTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {certTags.map((tag) => (
                          <Badge key={tag} variant="outline" className="gap-1 font-normal">
                            <Award size={10} /> {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5">
                  <Phone size={12} /> Contact information
                </p>
                <p>
                  Your account email ({sessionEmail ?? "loading..."}) is shown on your public profile.
                  Add rate, location and bio so potential clients can reach out with confidence.
                </p>
              </div>

              {notice && (
                <div
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    notice.type === "success"
                      ? "border-emerald-500/50 bg-emerald-50 text-emerald-700"
                      : "border-destructive/50 bg-destructive/10 text-destructive"
                  }`}
                >
                  {notice.message}
                </div>
              )}

              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {profile ? "Update Portfolio" : "Publish Portfolio"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
