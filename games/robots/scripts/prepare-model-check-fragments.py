"""Verify editable NLA tracks reproduce grounded original-mesh wrecks."""
import bpy
objects=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('OriginalFragment_')]
assert len(objects)==21
assert sum(len(o.data.polygons) for o in objects)==14674
for take in ['overload','coreRip','brutality']:
    for obj in objects:
        for track in obj.animation_data.nla_tracks: track.mute=track.name!=take
    for frame in range(1,122,4):
        bpy.context.scene.frame_set(frame)
        for obj in objects:
            minimum=min((obj.matrix_world@v.co).z for v in obj.data.vertices)
            assert minimum>=-.0002,f'{take}/{frame}/{obj.name}: penetrates floor {minimum}'
print('Verified 21 original fragments / 14,674 triangles / all 3 editable NLA takes above floor.')
