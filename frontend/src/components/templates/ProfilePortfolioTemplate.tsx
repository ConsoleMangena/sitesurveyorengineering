import { useState } from "react";
import {
  Award,
  BadgeCheck,
  Briefcase,
  Clock,
  DollarSign,
  Images,
  Mail,
  MapPin,
  Phone,
  Star,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** One project-showcase entry on the public portfolio. */
export interface PortfolioShowcaseItem {
  id: string;
  title: string;
  description?: string | null;
  year?: string | null;
  imageUrl: string | null;
}

export interface ProfilePortfolioData {
  name: string;
  title?: string;
  discipline?: string;
  experience?: string;
  location?: string;
  rate?: number;
  ratePer?: string;
  currency?: string;
  availability?: string;
  isAvailable?: boolean;
  bio?: string;
  skills?: string[];
  certifications?: string[];
  email?: string | null;
  phone?: string | null;
  rating?: number | null;
  reviews?: number | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  verified?: boolean;
  showcase?: PortfolioShowcaseItem[];
  fallbackInitials?: string;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

interface ProfilePortfolioTemplateProps {
  profile: ProfilePortfolioData;
  className?: string;
}

export function ProfilePortfolioTemplate({
  profile,
  className,
}: ProfilePortfolioTemplateProps) {
  const [preview, setPreview] = useState<PortfolioShowcaseItem | null>(null);
  const {
    name,
    title,
    discipline,
    experience,
    location,
    rate,
    ratePer,
    currency,
    availability,
    isAvailable,
    bio,
    skills = [],
    certifications = [],
    email,
    phone,
    rating,
    reviews,
    avatarUrl,
    bannerUrl,
    verified,
    showcase = [],
    fallbackInitials,
  } = profile;

  const availabilityLabel = isAvailable
    ? "Available for hire"
    : availability || "Unavailable";

  const badgeVariant = isAvailable ? ("success" as const) : ("secondary" as const);

  return (
    <Card
      className={cn(
        "overflow-hidden border bg-card text-card-foreground shadow-sm",
        className
      )}
    >
      <div className="relative h-24 bg-gradient-to-r from-primary/80 to-primary/40">
        {bannerUrl && (
          <img
            src={bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <CardContent className="relative px-5 pb-5 pt-0">
        <div className="-mt-10 mb-4 flex items-end justify-between">
          <Avatar className="h-20 w-20 border-4 border-background shadow-md">
            <AvatarImage src={avatarUrl ?? undefined} alt={name} />
            <AvatarFallback className="bg-primary text-primary-foreground text-xl font-semibold">
              {getInitials(name || fallbackInitials || "U")}
            </AvatarFallback>
          </Avatar>
          <Badge variant={badgeVariant} className="mb-1">
            {availabilityLabel}
          </Badge>
        </div>

        <div className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-xl font-bold tracking-tight">
            <span className="truncate">
              {name.trim() || "Your Name"}
            </span>
            {verified && (
              <BadgeCheck
                className="size-5 shrink-0 text-emerald-600"
                aria-label="Verified professional"
              />
            )}
          </h3>
          <p className="text-sm text-muted-foreground">
            {[title, discipline].filter(Boolean).join(" · ") || "Professional title"}
          </p>
        </div>

        {bio ? (
          <p className="mt-3 text-sm leading-relaxed text-foreground/90 line-clamp-4">
            {bio}
          </p>
        ) : (
          <p className="mt-3 text-sm italic text-muted-foreground">
            Add a short bio to tell clients what you do.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {location && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <MapPin size={12} /> {location}
            </span>
          )}
          {experience && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <Clock size={12} /> {experience}
            </span>
          )}
          {Number(rate) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <DollarSign size={12} /> {Number(rate).toLocaleString()} {currency} / {ratePer}
            </span>
          )}
          {email && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <Mail size={12} /> {email}
            </span>
          )}
          {phone && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <Phone size={12} /> {phone}
            </span>
          )}
          {rating != null && rating > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2.5 py-1">
              <Star size={12} className="text-amber-500" /> {rating.toFixed(1)} ({reviews ?? 0})
            </span>
          )}
        </div>

        {(skills.length > 0 || certifications.length > 0) && <Separator className="my-4" />}

        {skills.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Briefcase size={12} /> Skills
            </div>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((tag) => (
                <Badge key={tag} variant="secondary" className="font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {certifications.length > 0 && (
          <div className={cn("space-y-2", skills.length > 0 && "mt-4")}>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Award size={12} /> Certifications
            </div>
            <div className="flex flex-wrap gap-1.5">
              {certifications.map((tag) => (
                <Badge key={tag} variant="outline" className="gap-1 font-normal">
                  <Award size={10} /> {tag}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {showcase.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Images size={12} /> Project Showcase
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {showcase.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreview(item)}
                  className="group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`View project ${item.title}`}
                >
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Images size={18} />
                    </span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-1.5 text-left text-[10px] font-medium text-white">
                    {item.title}
                    {item.year ? ` · ${item.year}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {email && (
          <div className="mt-4 flex justify-end">
            <Button size="sm" variant="outline" className="gap-2" asChild>
              <a href={`mailto:${email}`}>
                <Mail size={14} /> Contact
              </a>
            </Button>
          </div>
        )}
      </CardContent>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-lg p-3 sm:max-w-xl">
          {preview?.imageUrl ? (
            <img
              src={preview.imageUrl}
              alt={preview.title}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : null}
          <div className="space-y-1 px-1 pb-1">
            <DialogTitle className="text-sm font-semibold">
              {preview?.title}
              {preview?.year ? ` (${preview.year})` : ""}
            </DialogTitle>
            {preview?.description ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {preview.description}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default ProfilePortfolioTemplate;
