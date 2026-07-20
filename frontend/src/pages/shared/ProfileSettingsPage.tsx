import { useState, useEffect } from "react";
import { AlertTriangle, Trash2, Upload, User } from "lucide-react";
import {
  getMyProfile,
  updateMyProfile,
  requestAccountDeletion,
} from "../../lib/repositories/profiles.ts";
import { signOut } from "../../lib/auth/session.ts";
import { useThemeMode } from "../../lib/theme.ts";
import PageLoader from "../../components/PageLoader.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Switch } from "../../components/ui/switch.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui/card.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.tsx";
import { Badge } from "../../components/ui/badge.tsx";
import { Separator } from "../../components/ui/separator.tsx";

export default function ProfileSettingsPage() {
  const { isDarkMode, setThemeMode } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [bio, setBio] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        if (profile) {
          setFullName(profile.full_name ?? "");
          setProfessionalTitle(profile.professional_title ?? "");
          setPromoCode(profile.promo_code ?? "");
          setBio(profile.bio ?? "");
          setEmail(profile.email ?? "");
          setPhone(profile.phone ?? "");
        }
      })
      .catch((err) => setError(err.message ?? "Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateMyProfile({
        full_name: fullName.trim() || null,
        professional_title: professionalTitle.trim() || null,
        promo_code: promoCode.trim() || null,
        bio: bio.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      setNotice("Profile saved.");
      window.setTimeout(() => setNotice(null), 2300);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== "delete") {
      setDeleteError("Type delete to confirm.");
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await requestAccountDeletion();
      setShowDeleteAccount(false);
      await signOut();
      window.location.href = "/login?deleted=1";
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : "Failed to request account deletion.",
      );
      setDeleteLoading(false);
    }
  };

  const initials = fullName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";

  if (loading) {
    return (
      <div className="hub-body">
        <PageLoader />
      </div>
    );
  }

  return (
    <div className="hub-body mx-auto max-w-5xl space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert variant="success">
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1>Profile Settings</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage your personal information, licensing, and account security
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-indigo-500 text-xl font-bold text-primary-foreground">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-foreground">
                {fullName || "Your Name"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {professionalTitle || "Professional Title"}
              </p>
            </div>
            <Button variant="outline" size="sm" className="w-full sm:w-auto">
              <Upload className="mr-2 h-4 w-4" /> Upload Photo
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Your public profile and contact details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your legal or professional name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Professional Title</Label>
                <Input
                  id="title"
                  value={professionalTitle}
                  onChange={(e) => setProfessionalTitle(e.target.value)}
                  placeholder="E.g., Registered Land Surveyor"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="promo">Promo / Referral Code</Label>
              <Input
                id="promo"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Optional code for promotions"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bio">Professional Bio</Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Brief summary of your skills and experience"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account Security & Notifications</CardTitle>
              <CardDescription>Manage your sign-in and alert preferences</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="For 2FA and field contact"
                  />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Dark Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Use a darker interface optimized for low-light work
                  </p>
                </div>
                <Switch
                  checked={isDarkMode}
                  onCheckedChange={(checked) =>
                    setThemeMode(checked ? "dark" : "light")
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Two-Factor Authentication (2FA)</Label>
                  <p className="text-xs text-muted-foreground">
                    Require an SMS code when logging in
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Email Notifications</Label>
                  <p className="text-xs text-muted-foreground">
                    Receive updates about alerts and invites
                  </p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Danger Zone</CardTitle>
              <CardDescription>Irreversible account actions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Change Password</Label>
                  <p className="text-xs text-muted-foreground">
                    Send a secure magic link to reset your password
                  </p>
                </div>
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                  Reset Password
                </Button>
              </div>
              <Separator />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm text-destructive">Delete Account</Label>
                  <p className="text-xs text-muted-foreground">
                    Start a 30-day deletion process
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    setShowDeleteAccount(true);
                    setDeleteConfirmText("");
                    setDeleteError(null);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete Account
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showDeleteAccount} onOpenChange={setShowDeleteAccount}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Delete your account?
            </DialogTitle>
            <DialogDescription>
              This starts a 30-day grace period. After that, your profile,
              embedded wallet, and personal data will be permanently removed.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            You cannot undo this from the app. Workspace owners must transfer
            ownership or delete those workspaces first.
          </div>
          {deleteError && (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <strong>delete</strong> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="delete"
              autoFocus
            />
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => setShowDeleteAccount(false)}
              disabled={deleteLoading}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={deleteLoading || deleteConfirmText.trim().toLowerCase() !== "delete"}
              aria-busy={deleteLoading}
              className="w-full sm:w-auto"
            >
              {deleteLoading ? "Deleting…" : "Delete Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
