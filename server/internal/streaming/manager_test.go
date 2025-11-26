package streaming

import (
	"fmt"
	"testing"

	"github.com/earthring/server/internal/ringmap"
)

func TestComputeChunkWindowBasic(t *testing.T) {
	pose := CameraPose{
		RingPosition: 1500,
		ActiveFloor:  0,
	}
	window := ComputeChunkWindow(pose, 2500)
	if len(window) == 0 {
		t.Fatalf("expected chunk window to contain entries")
	}
	centerIdx := ringmap.PositionToChunkIndex(pose.RingPosition)
	expected := fmt.Sprintf("%d_%d", pose.ActiveFloor, centerIdx)
	if !contains(window, expected) {
		t.Fatalf("expected center chunk %s in %v", expected, window)
	}
}

func TestComputeChunkWindowWraps(t *testing.T) {
	pose := CameraPose{
		RingPosition: ringmap.RingCircumference - 500,
		ActiveFloor:  2,
	}
	window := ComputeChunkWindow(pose, 1500)
	found := false
	for _, id := range window {
		if id == "2_0" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected wrapped chunk 2_0 in window: %#v", window)
	}
}

func contains(list []string, target string) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}

func TestPlanSubscriptionValidation(t *testing.T) {
	manager := NewManager()
	req := SubscriptionRequest{
		Pose: CameraPose{
			RingPosition: 0,
			ActiveFloor:  0,
		},
		RadiusMeters:  1000,
		IncludeChunks: true,
	}

	plan, err := manager.PlanSubscription(42, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan.SubscriptionID == "" {
		t.Fatalf("expected subscription id to be set")
	}
	if len(plan.ChunkIDs) == 0 {
		t.Fatalf("expected chunk ids in plan")
	}

	_, err = manager.PlanSubscription(42, SubscriptionRequest{})
	if err == nil {
		t.Fatalf("expected validation error for empty request")
	}
}

func TestUpdatePoseProducesChunkDeltas(t *testing.T) {
	manager := NewManager()
	req := SubscriptionRequest{
		Pose: CameraPose{
			RingPosition: 0,
			ActiveFloor:  0,
		},
		RadiusMeters:  ringmap.ChunkLength * 2,
		IncludeChunks: true,
	}

	plan, err := manager.PlanSubscription(7, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	newPose := CameraPose{
		RingPosition: int64(ringmap.ChunkLength * 3),
		ActiveFloor:  0,
	}

	delta, err := manager.UpdatePose(7, plan.SubscriptionID, newPose)
	if err != nil {
		t.Fatalf("unexpected error computing delta: %v", err)
	}

	if len(delta.AddedChunks) == 0 && len(delta.RemovedChunks) == 0 {
		t.Fatalf("expected chunk delta to include adds or removes, got %#v", delta)
	}
	if len(delta.CurrentChunks) == 0 {
		t.Fatalf("expected current chunk set after update")
	}
}

func TestUpdatePoseValidatesOwnershipAndIDs(t *testing.T) {
	manager := NewManager()
	req := SubscriptionRequest{
		Pose: CameraPose{
			RingPosition: 0,
			ActiveFloor:  0,
		},
		RadiusMeters:  1000,
		IncludeChunks: true,
	}

	plan, err := manager.PlanSubscription(100, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, err := manager.UpdatePose(999, plan.SubscriptionID, req.Pose); err == nil {
		t.Fatalf("expected ownership validation error")
	}
	if _, err := manager.UpdatePose(100, "missing_sub", req.Pose); err == nil {
		t.Fatalf("expected missing subscription error")
	}
}

func TestComputeZoneDelta(t *testing.T) {
	manager := NewManager()
	req := SubscriptionRequest{
		Pose: CameraPose{
			RingPosition: 0,
			ActiveFloor:  0,
		},
		RadiusMeters:  5000,
		WidthMeters:   5000,
		IncludeZones:  true,
	}

	plan, err := manager.PlanSubscription(50, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Initial zone set
	initialZones := []int64{1, 2, 3}
	delta1, err := manager.ComputeZoneDelta(plan.SubscriptionID, initialZones)
	if err != nil {
		t.Fatalf("unexpected error computing initial delta: %v", err)
	}
	if len(delta1.AddedZoneIDs) != 3 {
		t.Fatalf("expected 3 added zones, got %d", len(delta1.AddedZoneIDs))
	}
	if len(delta1.RemovedZoneIDs) != 0 {
		t.Fatalf("expected 0 removed zones, got %d", len(delta1.RemovedZoneIDs))
	}

	// Update with overlapping zones
	updatedZones := []int64{2, 3, 4, 5}
	delta2, err := manager.ComputeZoneDelta(plan.SubscriptionID, updatedZones)
	if err != nil {
		t.Fatalf("unexpected error computing update delta: %v", err)
	}
	if len(delta2.AddedZoneIDs) != 2 {
		t.Fatalf("expected 2 added zones (4,5), got %d: %v", len(delta2.AddedZoneIDs), delta2.AddedZoneIDs)
	}
	if len(delta2.RemovedZoneIDs) != 1 {
		t.Fatalf("expected 1 removed zone (1), got %d: %v", len(delta2.RemovedZoneIDs), delta2.RemovedZoneIDs)
	}
	if !containsInt64(delta2.AddedZoneIDs, 4) || !containsInt64(delta2.AddedZoneIDs, 5) {
		t.Fatalf("expected added zones to include 4 and 5, got %v", delta2.AddedZoneIDs)
	}
	if !containsInt64(delta2.RemovedZoneIDs, 1) {
		t.Fatalf("expected removed zones to include 1, got %v", delta2.RemovedZoneIDs)
	}
}

func TestComputeZoneBoundingBox(t *testing.T) {
	pose := CameraPose{
		RingPosition: 10000,
		WidthOffset:   500,
		ActiveFloor:   0,
	}
	bbox := ComputeZoneBoundingBox(pose, 5000, 3000)
	if bbox.Floor != 0 {
		t.Fatalf("expected floor 0, got %d", bbox.Floor)
	}
	if bbox.MinX >= bbox.MaxX {
		t.Fatalf("expected minX < maxX, got minX=%f maxX=%f", bbox.MinX, bbox.MaxX)
	}
	if bbox.MinY >= bbox.MaxY {
		t.Fatalf("expected minY < maxY, got minY=%f maxY=%f", bbox.MinY, bbox.MaxY)
	}
	// Check that bounds are centered around pose
	expectedCenterX := float64(pose.RingPosition)
	if bbox.MinX > expectedCenterX || bbox.MaxX < expectedCenterX {
		t.Fatalf("expected bounding box to contain pose X position %f, got [%f, %f]", expectedCenterX, bbox.MinX, bbox.MaxX)
	}
}

func containsInt64(list []int64, target int64) bool {
	for _, value := range list {
		if value == target {
			return true
		}
	}
	return false
}
